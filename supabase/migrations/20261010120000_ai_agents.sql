-- Durable queue is separate from LangGraph's private checkpoint schema.
create table public.agent_runs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id text not null,
  actor_id uuid not null references auth.users,
  model_key text not null,
  model_config jsonb not null,
  brief text not null check (length(brief) between 1 and 4000),
  status text not null default 'Queued' check (status in ('Queued','Running','Awaiting approval','Completed','Rejected','Failed')),
  detail text not null default 'Waiting for the AI worker.',
  proposal jsonb,
  decision boolean,
  decided_by uuid references auth.users,
  decided_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create unique index agent_one_active on public.agent_runs(workspace_id,client_id) where status in ('Queued','Running','Awaiting approval');
create index agent_queue on public.agent_runs(created_at) where status in ('Queued','Running');
alter table public.agent_runs enable row level security;
create policy agent_read on public.agent_runs for select to authenticated using (
  public.workspace_role(workspace_id) in ('owner','team_member') and public.can_access_client(workspace_id,client_id)
);
revoke all on public.agent_runs from public,anon,authenticated;
grant select(id,workspace_id,client_id,model_key,brief,status,detail,proposal,created_at,finished_at,decided_by,decided_at) on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;

-- Explicit actor checks for worker calls: the service token must never stand in for membership.
create function public.agent_actor_allowed(wid uuid,cid text,actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id=wid and m.user_id=actor
    and (m.role='owner' or (m.role='team_member' and exists(select 1 from public.client_access a where a.workspace_id=wid and a.user_id=actor and a.client_id=cid))))
$$;
revoke execute on function public.agent_actor_allowed(uuid,text,uuid) from public,anon,authenticated;

create function public.enqueue_agent(wid uuid,cid text,request_id uuid,model_config jsonb,prompt text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare old public.agent_runs;
begin
  perform 1 from public.workspaces where id=wid for update;
  if auth.uid() is null or not public.agent_actor_allowed(wid,cid,auth.uid()) then raise exception 'AI agent access denied.'; end if;
  if not exists(select 1 from public.clients where workspace_id=wid and id=cid) then raise exception 'Client not found.'; end if;
  if request_id is null or prompt is null or length(trim(prompt)) not between 1 and 4000
    or jsonb_typeof(model_config) is distinct from 'object' or coalesce(model_config->>'key','') !~ '^[a-zA-Z0-9_-]{1,100}$'
    or coalesce(model_config->>'provider','') not in ('openai','anthropic') or coalesce(length(model_config->>'model'),0) not between 1 and 200
    then raise exception 'Invalid agent request.'; end if;
  select * into old from public.agent_runs where id=request_id;
  if old.id is not null then
    if old.workspace_id=wid and old.client_id=cid and old.actor_id=auth.uid() and old.brief=prompt and old.model_config=enqueue_agent.model_config then return request_id; end if;
    raise exception 'Request ID is already in use.';
  end if;
  if exists(select 1 from public.agent_runs where workspace_id=wid and client_id=cid and status in ('Queued','Running','Awaiting approval')) then raise exception 'Review or wait for the active AI run first.'; end if;
  if (select count(*) from public.agent_runs where workspace_id=wid and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly AI run limit reached.'; end if;
  insert into public.agent_runs(id,workspace_id,client_id,actor_id,model_key,model_config,brief)
    values(request_id,wid,cid,auth.uid(),model_config->>'key',model_config,prompt);
  return request_id;
end $$;

create function public.decide_agent(wid uuid,run_id uuid,approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs;
begin
  perform 1 from public.workspaces where id=wid for update;
  select * into job from public.agent_runs where id=run_id and workspace_id=wid for update;
  if job.id is null or auth.uid() is null or not public.agent_actor_allowed(wid,job.client_id,auth.uid()) then raise exception 'AI agent access denied.'; end if;
  if job.decision is not null and job.decision=approved then return; end if;
  if approved is null or job.status<>'Awaiting approval' or job.proposal is null then raise exception 'This run is not waiting for a decision.'; end if;
  update public.agent_runs set decision=approved,decided_by=auth.uid(),decided_at=now(),status='Queued',attempts=0,
    detail=case when approved then 'Draft creation accepted. Waiting for worker.' else 'Rejection queued.' end where id=run_id;
  insert into public.activity_log(workspace_id,client_id,actor_id,summary) values(wid,job.client_id,auth.uid(),case when approved then 'AI draft proposal accepted' else 'AI draft proposal rejected' end);
end $$;

create function public.claim_agent() returns setof public.agent_runs
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs;
begin
  for job in select * from public.agent_runs where status='Queued' or (status='Running' and lease_until<now()) order by created_at limit 20 loop
    perform 1 from public.workspaces where id=job.workspace_id for update skip locked;
    if not found then continue; end if;
    select * into job from public.agent_runs where id=job.id and (status='Queued' or (status='Running' and lease_until<now())) for update skip locked;
    if not found then continue; end if;
    if job.attempts>=3 or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id)
      or (job.decision is true and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.decided_by)) then
      update public.agent_runs set status='Failed',detail='Retry limit reached or client access revoked.',finished_at=now(),lease=null,lease_until=null where id=job.id;
      continue;
    end if;
    update public.agent_runs set status='Running',detail='AI worker processing.',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id returning * into job;
    return next job; return;
  end loop;
end $$;

create function public.agent_context(run_id uuid,token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs; brand jsonb;
begin
  select * into job from public.agent_runs where id=run_id;
  if job.status is distinct from 'Running' or job.lease is distinct from token or token is null or job.lease_until<now()
    or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id) then raise exception 'Agent lease or access expired.'; end if;
  select payload into brand from public.clients where workspace_id=job.workspace_id and id=job.client_id;
  return jsonb_build_object('name',brand->>'name','voice',brand->>'voice','audience',brand->>'audience','description',brand->>'description');
end $$;

create function public.finish_agent(run_id uuid,token uuid,outcome text,plan jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs; p jsonb; idx integer:=0; post jsonb;
begin
  select * into job from public.agent_runs where id=run_id;
  perform 1 from public.workspaces where id=job.workspace_id for update;
  select * into job from public.agent_runs where id=run_id for update;
  if job.status is distinct from 'Running' or token is null or job.lease is distinct from token or job.lease_until<now() then raise exception 'Agent lease expired.'; end if;
  if not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id) then raise exception 'Client access revoked.'; end if;
  if outcome='Awaiting approval' then
    if job.decision is not null or jsonb_typeof(plan->'posts') is distinct from 'array' or jsonb_array_length(plan->'posts')<>5 then raise exception 'Invalid proposal.'; end if;
    for p in select value from jsonb_array_elements(plan->'posts') loop
      if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'title') is distinct from 'string' or length(trim(p->>'title')) not between 1 and 200
        or jsonb_typeof(p->'caption') is distinct from 'string' or length(trim(p->>'caption')) not between 1 and 5000
        or coalesce(p->>'platform','') not in ('Instagram','Facebook','LinkedIn','TikTok','X') then raise exception 'Invalid proposal.'; end if;
    end loop;
    update public.agent_runs set proposal=plan,status=outcome,detail='Review the generated captions before creating drafts.',lease=null,lease_until=null where id=run_id;
  elsif outcome='Completed' then
    if job.decision is distinct from true or job.proposal is null or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.decided_by) then raise exception 'Human draft acceptance required.'; end if;
    for p in select value from jsonb_array_elements(job.proposal->'posts') loop
      idx:=idx+1;
      post:=jsonb_build_object('id','ai-'||job.id::text||'-'||idx,'clientId',job.client_id,'title',p->>'title','caption',p->>'caption','platform',p->>'platform',
        'date','','time','09:00','status','Draft','assetId','','notes','[]'::jsonb);
      if not public.valid_post_payload(post) then raise exception 'Invalid post payload.'; end if;
      insert into public.records(workspace_id,kind,id,client_id,payload) values(job.workspace_id,'posts',post->>'id',job.client_id,post);
    end loop;
    update public.agent_runs set status=outcome,detail='Five AI drafts created. Submit them through the normal content approval flow.',finished_at=now(),lease=null,lease_until=null where id=run_id;
    insert into public.activity_log(workspace_id,client_id,actor_id,summary) values(job.workspace_id,job.client_id,job.decided_by,'Five AI content drafts created');
  elsif outcome='Rejected' then
    if job.decision is distinct from false then raise exception 'Human rejection required.'; end if;
    update public.agent_runs set status=outcome,detail='Proposal rejected. No content created.',finished_at=now(),lease=null,lease_until=null where id=run_id;
  elsif outcome='Failed' then
    update public.agent_runs set status=outcome,detail='AI generation failed. Check worker configuration and provider availability, then start a new run.',finished_at=now(),lease=null,lease_until=null where id=run_id;
  else raise exception 'Invalid agent outcome.';
  end if;
end $$;
revoke execute on function public.enqueue_agent(uuid,text,uuid,jsonb,text),public.decide_agent(uuid,uuid,boolean),public.claim_agent(),public.agent_context(uuid,uuid),public.finish_agent(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_agent(uuid,text,uuid,jsonb,text),public.decide_agent(uuid,uuid,boolean) to authenticated;
grant execute on function public.claim_agent(),public.agent_context(uuid,uuid),public.finish_agent(uuid,uuid,text,jsonb) to service_role;
