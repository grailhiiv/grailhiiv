-- Dedicated execution records cannot be forged through commit_records.
create table public.automation_bindings (
  workspace_id uuid not null,
  kind text not null default 'automations' check (kind = 'automations'),
  automation_id text not null,
  client_id text not null,
  workflow_key text not null check (workflow_key ~ '^[a-zA-Z0-9_-]{1,100}$'),
  primary key (workspace_id,automation_id),
  foreign key (workspace_id,kind,automation_id) references public.records(workspace_id,kind,id) on delete cascade
);
create table public.automation_runs (
  id uuid primary key,
  workspace_id uuid not null,
  kind text not null default 'automations' check (kind = 'automations'),
  automation_id text not null,
  client_id text not null,
  actor_id uuid not null references auth.users on delete cascade,
  workflow_key text not null,
  automation_name text not null,
  status text not null default 'Queued' check (status in ('Queued','Running','Success','Failed','Unknown')),
  detail text not null default 'Waiting for the automation worker.',
  execution_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (workspace_id,kind,automation_id) references public.records(workspace_id,kind,id) on delete cascade
);
create unique index automation_one_active on public.automation_runs(workspace_id,automation_id)
  where status in ('Queued','Running');
create index automation_run_history on public.automation_runs(workspace_id,created_at desc);
create index automation_run_queue on public.automation_runs(created_at) where status='Queued';
alter table public.automation_bindings enable row level security;
alter table public.automation_runs enable row level security;
create policy automation_binding_read on public.automation_bindings for select to authenticated
  using (public.workspace_role(workspace_id) in ('owner','team_member') and public.can_access_client(workspace_id,client_id));
create policy automation_run_read on public.automation_runs for select to authenticated
  using (public.workspace_role(workspace_id) in ('owner','team_member') and public.can_access_client(workspace_id,client_id));
revoke all on public.automation_bindings, public.automation_runs from public,anon,authenticated;
grant select on public.automation_bindings, public.automation_runs to authenticated;
grant all on public.automation_bindings, public.automation_runs to service_role;

create function public.bind_automation(wid uuid, aid text, workflow text)
returns void language plpgsql security definer set search_path = '' as $$
declare cid text;
begin
  if auth.uid() is null or public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can connect workflows.'; end if;
  perform 1 from public.workspaces where id=wid for update;
  if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can connect workflows.'; end if;
  select client_id into cid from public.records where workspace_id=wid and kind='automations' and id=aid;
  if cid is null then raise exception 'Automation not found.'; end if;
  if exists(select 1 from public.automation_runs where workspace_id=wid and automation_id=aid and status in ('Queued','Running')) then
    raise exception 'Wait for the active run before changing its workflow.';
  end if;
  if workflow is null then delete from public.automation_bindings where workspace_id=wid and automation_id=aid;
  else
    if workflow !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid workflow key.'; end if;
    insert into public.automation_bindings(workspace_id,automation_id,client_id,workflow_key) values(wid,aid,cid,workflow)
      on conflict(workspace_id,automation_id) do update set workflow_key=excluded.workflow_key,client_id=excluded.client_id;
  end if;
  insert into public.activity_log(workspace_id,client_id,actor_id,summary)
    values(wid,cid,auth.uid(),case when workflow is null then 'Automation disconnected: ' else 'Automation connected: ' end || aid);
end $$;

create function public.enqueue_automation(wid uuid, aid text, request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rec public.records; binding public.automation_bindings; previous public.automation_runs;
begin
  if auth.uid() is null or public.workspace_role(wid) not in ('owner','team_member') or public.workspace_role(wid) is null then
    raise exception 'Automation access denied.';
  end if;
  if request_id is null then raise exception 'A request ID is required.'; end if;
  perform 1 from public.workspaces where id=wid for update;
  select * into rec from public.records where workspace_id=wid and kind='automations' and id=aid;
  if rec.id is null or not public.can_access_client(wid,rec.client_id) then raise exception 'Client access denied.'; end if;
  if public.workspace_role(wid) not in ('owner','team_member') or public.workspace_role(wid) is null then raise exception 'Automation access denied.'; end if;
  select * into previous from public.automation_runs where id=request_id;
  if previous.id is not null then
    if previous.workspace_id=wid and previous.automation_id=aid and previous.actor_id=auth.uid() then return request_id; end if;
    raise exception 'Request ID is already in use.';
  end if;
  if rec.payload->'enabled' is distinct from 'true'::jsonb then raise exception 'Enable this automation first.'; end if;
  select * into binding from public.automation_bindings where workspace_id=wid and automation_id=aid;
  if binding.automation_id is null or binding.client_id<>rec.client_id then raise exception 'Connect a workflow first.'; end if;
  if exists(select 1 from public.automation_runs where workspace_id=wid and automation_id=aid and status in ('Queued','Running')) then
    raise exception 'This automation already has an active run.';
  end if;
  insert into public.automation_runs(id,workspace_id,automation_id,client_id,actor_id,workflow_key,automation_name)
    values(request_id,wid,aid,rec.client_id,auth.uid(),binding.workflow_key,left(coalesce(rec.payload->>'name',aid),200));
  insert into public.activity_log(workspace_id,client_id,actor_id,summary)
    values(wid,rec.client_id,auth.uid(),'Automation queued: ' || coalesce(rec.payload->>'name',aid));
  return request_id;
end $$;

-- Worker-only queue claim. Lock ordering matches commit_records/manage_member.
-- No redispatch after claiming: an ambiguous network failure must not duplicate an action.
create function public.claim_automation()
returns setof public.automation_runs language plpgsql security definer set search_path = '' as $$
declare job public.automation_runs; current_payload jsonb; current_workflow text; actor_role text;
begin
  update public.automation_runs set status='Unknown',detail='No completion received. Check n8n executions before running again.',finished_at=now()
    where status='Running' and started_at < now()-interval '15 minutes';
  update public.automation_runs set status='Failed',detail='The worker did not pick up this request within one hour.',finished_at=now()
    where status='Queued' and created_at < now()-interval '1 hour';
  -- Acquire workspace before run to avoid a deadlock with owner binding changes.
  for job in select * from public.automation_runs where status='Queued' order by created_at limit 20 loop
    perform 1 from public.workspaces where id=job.workspace_id for update skip locked;
    if not found then continue; end if;
    select * into job from public.automation_runs where id=job.id and status='Queued' for update skip locked;
    if not found then continue; end if;
    select payload into current_payload from public.records where workspace_id=job.workspace_id and kind='automations' and id=job.automation_id;
    select workflow_key into current_workflow from public.automation_bindings where workspace_id=job.workspace_id and automation_id=job.automation_id;
    select role into actor_role from public.workspace_members where workspace_id=job.workspace_id and user_id=job.actor_id;
    if current_payload->'enabled' is distinct from 'true'::jsonb or current_payload->>'clientId' is distinct from job.client_id
      or current_workflow is distinct from job.workflow_key or actor_role is null or actor_role not in ('owner','team_member')
      or (actor_role<>'owner' and not exists(select 1 from public.client_access where workspace_id=job.workspace_id and user_id=job.actor_id and client_id=job.client_id)) then
      update public.automation_runs set status='Failed',detail='Automation disabled, disconnected, or access revoked before dispatch.',finished_at=now() where id=job.id;
      continue;
    end if;
    update public.automation_runs set status='Running',detail='Dispatched to n8n. Waiting for completion.',started_at=now()
      where id=job.id returning * into job;
    return next job;
    return;
  end loop;
end $$;

create function public.finish_automation(run_id uuid, outcome text, message text, execution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare job public.automation_runs; wid uuid;
begin
  if outcome is null or outcome not in ('Success','Failed','Unknown') or message is null or length(message) not between 1 and 1000
    or (execution is not null and execution !~ '^[a-zA-Z0-9_-]{1,100}$') then raise exception 'Invalid execution result.'; end if;
  select workspace_id into wid from public.automation_runs where id=run_id;
  if wid is null then raise exception 'Run not found.'; end if;
  perform 1 from public.workspaces where id=wid for update;
  select * into job from public.automation_runs where id=run_id for update;
  if job.id is null then raise exception 'Run not found.'; end if;
  -- Duplicate callbacks acknowledge the same result without overwriting history.
  if job.status=outcome and job.execution_id is not distinct from execution then return; end if;
  if job.status<>'Running' or job.started_at < now()-interval '15 minutes' then raise exception 'Run cannot accept this result.'; end if;
  update public.automation_runs set status=outcome,detail=message,execution_id=execution,finished_at=now() where id=run_id;
  insert into public.activity_log(workspace_id,client_id,actor_id,summary)
    values(job.workspace_id,job.client_id,job.actor_id,'Automation ' || lower(outcome) || ': ' || job.automation_name);
end $$;
revoke execute on function public.bind_automation(uuid,text,text),public.enqueue_automation(uuid,text,uuid),
  public.claim_automation(),public.finish_automation(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bind_automation(uuid,text,text),public.enqueue_automation(uuid,text,uuid) to authenticated;
grant execute on function public.claim_automation(),public.finish_automation(uuid,text,text,text) to service_role;
