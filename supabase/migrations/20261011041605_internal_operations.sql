-- Additive operations: existing posts, approvals and provider credentials stay intact.
alter table public.agent_runs add column generation_seq integer not null default 0;
alter table public.agent_runs add column regenerate_index integer check (regenerate_index between 0 and 4);
alter table public.agent_runs add column change_request uuid;
alter table public.agent_runs add column changed_by uuid references auth.users;
alter table public.agent_runs add column checkpoint_pruned_at timestamptz;

create table public.workspace_operations (
 workspace_id uuid primary key references public.workspaces on delete cascade,
 hourly_ai_calls integer not null default 30 check(hourly_ai_calls between 1 and 200),
 daily_ai_tokens integer not null default 100000 check(daily_ai_tokens between 1000 and 10000000),
 daily_ai_budget numeric not null default 0 check(daily_ai_budget between 0 and 10000),
 asset_quota_bytes bigint not null default 1073741824 check(asset_quota_bytes between 10485760 and 107374182400),
 checkpoint_days integer not null default 30 check(checkpoint_days between 1 and 365),
 reasoning_effort text not null default 'default' check(reasoning_effort in ('default','none','low','medium','high','xhigh','max'))
);
create table public.agent_usage (
 id uuid primary key default gen_random_uuid(), run_id uuid references public.agent_runs on delete set null,
 workspace_id uuid not null references public.workspaces on delete cascade, client_id text not null,
 token uuid not null, generation_seq integer not null, reserved_tokens integer not null,
 input_tokens integer, output_tokens integer, estimated_cost numeric, reserved_cost numeric not null default 0,
 created_at timestamptz not null default now(), unique(run_id,token),
 check(input_tokens is null or input_tokens>=0), check(output_tokens is null or output_tokens>=0)
);
create index agent_usage_workspace_time on public.agent_usage(workspace_id,created_at);
create table public.worker_status (
 name text primary key check(name in ('ai','n8n','internal','backup')),
 last_seen timestamptz not null default now(), healthy boolean not null, error_code text not null default ''
);
create table public.backup_runs (
 id uuid primary key default gen_random_uuid(), status text not null check(status in ('Success','Failed')),
 detail text not null check(length(detail)<=200), created_at timestamptz not null default now()
);
create table public.asset_uploads (
 id uuid primary key, workspace_id uuid not null references public.workspaces on delete cascade,
 client_id text not null, actor_id uuid not null references auth.users,
 bytes bigint not null check(bytes between 1 and 10616832), paths text[] not null,
 expires_at timestamptz not null default now()+interval '15 minutes',
 foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create index asset_upload_expiry on public.asset_uploads(expires_at);
create table public.internal_rules (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
 client_id text not null, actor_id uuid not null references auth.users, name text not null check(length(name) between 1 and 100),
 event text not null check(event in ('lead_created','post_approved','schedule')),
 action text not null check(action in ('activity','followup')), message text not null check(length(message) between 1 and 500),
 interval_minutes integer not null default 60 check(interval_minutes between 5 and 10080),
 due_days integer not null default 3 check(due_days between 0 and 90), enabled boolean not null default false,
 next_run timestamptz not null default now(), created_at timestamptz not null default now(),
 check(action<>'followup' or event='lead_created'),
 foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create table public.internal_runs (
 id uuid primary key default gen_random_uuid(), rule_id uuid not null references public.internal_rules on delete cascade,
 workspace_id uuid not null, client_id text not null, event_key text not null, record_id text,
 status text not null default 'Queued' check(status in ('Queued','Success','Failed')), attempts integer not null default 0,
 detail text not null default 'Waiting for internal automation.', created_at timestamptz not null default now(), finished_at timestamptz,
 unique(rule_id,event_key), foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create index internal_queue on public.internal_runs(created_at) where status='Queued';
create index internal_schedule on public.internal_rules(next_run) where enabled and event='schedule';
alter table public.workspace_operations enable row level security;
alter table public.agent_usage enable row level security;
alter table public.worker_status enable row level security;
alter table public.backup_runs enable row level security;
alter table public.asset_uploads enable row level security;
alter table public.internal_rules enable row level security;
alter table public.internal_runs enable row level security;
create policy operations_read on public.workspace_operations for select to authenticated using(public.workspace_role(workspace_id)='owner');
create policy usage_read on public.agent_usage for select to authenticated using(public.workspace_role(workspace_id)='owner');
create policy internal_rules_read on public.internal_rules for select to authenticated using(public.workspace_role(workspace_id)='owner');
create policy internal_runs_read on public.internal_runs for select to authenticated using(public.workspace_role(workspace_id)='owner');
revoke all on public.workspace_operations,public.agent_usage,public.worker_status,public.backup_runs,public.asset_uploads,public.internal_rules,public.internal_runs from public,anon,authenticated;
grant select on public.workspace_operations,public.agent_usage,public.internal_rules,public.internal_runs to authenticated;
grant all on public.workspace_operations,public.agent_usage,public.worker_status,public.backup_runs,public.asset_uploads,public.internal_rules,public.internal_runs to service_role;

create function public.save_operations(wid uuid,settings jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.workspaces where id=wid for update;
 if auth.uid() is null or public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can change operational limits.'; end if;
 if jsonb_typeof(settings) is distinct from 'object' then raise exception 'Invalid limits.'; end if;
 insert into public.workspace_operations(workspace_id,hourly_ai_calls,daily_ai_tokens,daily_ai_budget,asset_quota_bytes,checkpoint_days,reasoning_effort) values(wid,(settings->>'hourly_ai_calls')::integer,(settings->>'daily_ai_tokens')::integer,
 (settings->>'daily_ai_budget')::numeric,(settings->>'asset_quota_bytes')::bigint,(settings->>'checkpoint_days')::integer,coalesce(settings->>'reasoning_effort','default'))
 on conflict(workspace_id) do update set hourly_ai_calls=excluded.hourly_ai_calls,daily_ai_tokens=excluded.daily_ai_tokens,
 daily_ai_budget=excluded.daily_ai_budget,asset_quota_bytes=excluded.asset_quota_bytes,checkpoint_days=excluded.checkpoint_days,reasoning_effort=excluded.reasoning_effort;
end $$;

create function public.worker_heartbeat(worker text,ok boolean,code text default '') returns void language plpgsql security definer set search_path='' as $$
begin
 if code is null or code not in ('','database_unavailable','provider_or_job_failed','backup_failed') then raise exception 'Invalid worker code.'; end if;
 insert into public.worker_status values(worker,now(),ok,code) on conflict(name) do update set last_seen=now(),healthy=ok,error_code=code;
end $$;

create function public.reserve_agent_call(rid uuid,lease_token uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare job public.agent_runs; settings public.workspace_operations; reserved integer; cost numeric; total_tokens bigint; total_cost numeric; brand jsonb; existing uuid;
begin
 select * into job from public.agent_runs where id=rid;
 perform 1 from public.workspaces where id=job.workspace_id for update;
 select * into job from public.agent_runs where id=rid for update;
 if lease_token is null or job.lease is distinct from lease_token or job.status is distinct from 'Running' or job.lease_until<now()
 or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id)
 or (job.changed_by is not null and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.changed_by)) then raise exception 'Agent lease or access expired.'; end if;
 select id into existing from public.agent_usage where run_id=rid and token=lease_token;
 if existing is not null then return existing; end if;
 select * into settings from public.workspace_operations where workspace_id=job.workspace_id;
 select payload into brand from public.clients where workspace_id=job.workspace_id and id=job.client_id;
 reserved:=octet_length(coalesce(brand::text,''))+octet_length(job.brief)+octet_length(coalesce(job.proposal::text,''))+2000+coalesce((job.model_config->>'maxTokens')::integer,4096);
 cost:=((reserved-coalesce((job.model_config->>'maxTokens')::integer,4096))*coalesce((job.model_config->>'inputPricePerMillion')::numeric,0)
  +coalesce((job.model_config->>'maxTokens')::integer,4096)*coalesce((job.model_config->>'outputPricePerMillion')::numeric,0))/1000000;
 if (select count(*) from public.agent_usage where workspace_id=job.workspace_id and created_at>now()-interval '1 hour')>=coalesce(settings.hourly_ai_calls,30) then raise exception 'Hourly AI call limit reached.'; end if;
 select coalesce(sum(coalesce(input_tokens+output_tokens,reserved_tokens)),0),coalesce(sum(coalesce(estimated_cost,reserved_cost)),0)
 into total_tokens,total_cost from public.agent_usage where workspace_id=job.workspace_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if total_tokens+reserved>coalesce(settings.daily_ai_tokens,100000) then raise exception 'Daily AI token limit reached.'; end if;
 if coalesce(settings.daily_ai_budget,0)>0 and (job.model_config->'inputPricePerMillion' is null or job.model_config->'outputPricePerMillion' is null or total_cost+cost>settings.daily_ai_budget) then raise exception 'AI budget reached or model prices are missing.'; end if;
 insert into public.agent_usage(run_id,workspace_id,client_id,token,generation_seq,reserved_tokens,reserved_cost)
 values(rid,job.workspace_id,job.client_id,lease_token,job.generation_seq,reserved,cost) returning id into existing;
 return existing;
end $$;
create function public.report_agent_usage(rid uuid,lease_token uuid,input_count integer,output_count integer) returns void language plpgsql security definer set search_path='' as $$
declare job public.agent_runs;
begin
 if input_count is null or output_count is null or input_count<0 or output_count<0 then raise exception 'Invalid token usage.'; end if;
 select * into job from public.agent_runs where id=rid;
 if job.lease is distinct from lease_token or lease_token is null then raise exception 'Agent lease expired.'; end if;
 update public.agent_usage set input_tokens=input_count,output_tokens=output_count,
 estimated_cost=case when job.model_config ? 'inputPricePerMillion' and job.model_config ? 'outputPricePerMillion'
 then (input_count*(job.model_config->>'inputPricePerMillion')::numeric+output_count*(job.model_config->>'outputPricePerMillion')::numeric)/1000000 else null end
 where run_id=rid and token=lease_token and input_tokens is null;
end $$;

create function public.valid_agent_plan(wid uuid,cid text,plan jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p jsonb;
begin
 if jsonb_typeof(plan) is distinct from 'object' or jsonb_typeof(plan->'posts') is distinct from 'array' or jsonb_array_length(plan->'posts')<>5 then return false; end if;
 if exists(select 1 from jsonb_object_keys(plan) k where k<>'posts') then return false; end if;
 for p in select value from jsonb_array_elements(plan->'posts') loop
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in ('title','caption','platform','date','time','assetId')) then return false; end if;
 if jsonb_typeof(p->'title') is distinct from 'string' or length(trim(p->>'title')) not between 1 and 200
 or jsonb_typeof(p->'caption') is distinct from 'string' or length(trim(p->>'caption')) not between 1 and 5000
 or coalesce(p->>'platform','') not in ('Instagram','Facebook','LinkedIn','TikTok','X') then return false; end if;
 if p ? 'date' and (jsonb_typeof(p->'date')<>'string' or (p->>'date'<>'' and p->>'date' !~ '^\d{4}-\d{2}-\d{2}$')) then return false; end if;
 if coalesce(p->>'date','')<>'' then perform (p->>'date')::date; end if;
 if p ? 'time' and (jsonb_typeof(p->'time')<>'string' or p->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
 if p ? 'assetId' and (jsonb_typeof(p->'assetId')<>'string' or (p->>'assetId'<>'' and not exists(select 1 from public.records where workspace_id=wid and client_id=cid and kind='assets' and id=p->>'assetId'))) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
create function public.edit_agent_plan(wid uuid,rid uuid,expected jsonb,plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job public.agent_runs;
begin
 perform 1 from public.workspaces where id=wid for update;
 select * into job from public.agent_runs where id=rid and workspace_id=wid for update;
 if auth.uid() is null or job.id is null or not public.agent_actor_allowed(wid,job.client_id,auth.uid()) then raise exception 'AI agent access denied.'; end if;
 if job.status<>'Awaiting approval' or job.decision is not null or job.proposal is distinct from expected then raise exception 'Proposal changed. Reload before editing.'; end if;
 if not public.valid_agent_plan(wid,job.client_id,plan) then raise exception 'Invalid proposal or asset assignment.'; end if;
 update public.agent_runs set proposal=plan where id=rid;
 insert into public.activity_log(workspace_id,client_id,actor_id,summary) values(wid,job.client_id,auth.uid(),'AI proposal edited');
end $$;
create function public.decide_agent(wid uuid,run_id uuid,approved boolean,expected_plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare job public.agent_runs;
begin
 perform 1 from public.workspaces where id=wid for update;
 select * into job from public.agent_runs where id=run_id and workspace_id=wid for update;
 if job.proposal is distinct from expected_plan then raise exception 'Proposal changed. Reload before deciding.'; end if;
 perform public.decide_agent(wid,run_id,approved);
end $$;
-- The old overload remains only for the checked definer wrapper.
revoke execute on function public.decide_agent(uuid,uuid,boolean) from authenticated;

create function public.regenerate_agent_post(wid uuid,rid uuid,idx integer,expected jsonb,request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare job public.agent_runs;
begin
 perform 1 from public.workspaces where id=wid for update;
 select * into job from public.agent_runs where id=rid and workspace_id=wid for update;
 if auth.uid() is null or job.id is null or not public.agent_actor_allowed(wid,job.client_id,auth.uid()) then raise exception 'AI agent access denied.'; end if;
 if job.change_request=request_id and job.changed_by=auth.uid() then return; end if;
 if request_id is null or idx is null or idx not between 0 and 4 or job.status<>'Awaiting approval' or job.decision is not null or job.proposal is distinct from expected then raise exception 'Proposal changed or not ready for regeneration.'; end if;
 update public.agent_runs set status='Queued',detail='Regenerating one caption.',generation_seq=generation_seq+1,regenerate_index=idx,change_request=request_id,
 changed_by=auth.uid(),attempts=0,lease=null,lease_until=null where id=rid;
end $$;
create function public.retry_agent(wid uuid,rid uuid) returns void language plpgsql security definer set search_path='' as $$
declare job public.agent_runs;
begin
 perform 1 from public.workspaces where id=wid for update;
 select * into job from public.agent_runs where id=rid and workspace_id=wid for update;
 if auth.uid() is null or job.id is null or not public.agent_actor_allowed(wid,job.client_id,auth.uid()) then raise exception 'AI agent access denied.'; end if;
 if job.status<>'Failed' then raise exception 'Only failed runs can be retried.'; end if;
 if exists(select 1 from public.agent_runs where workspace_id=wid and client_id=job.client_id and id<>rid and status in ('Queued','Running','Awaiting approval')) then raise exception 'Wait for the active run.'; end if;
 update public.agent_runs set status=case when job.proposal is not null and job.decision is not null then 'Awaiting approval' else 'Queued' end,
 detail=case when job.proposal is not null and job.decision is not null then 'Review the saved proposal before retrying draft creation.' else 'Retry queued.' end,
 attempts=0,generation_seq=generation_seq+1,lease=null,lease_until=null,finished_at=null,changed_by=auth.uid(),decision=null,decided_by=null,decided_at=null where id=rid;
end $$;

create function public.reserve_asset_upload(wid uuid,cid text,rid uuid,amount bigint,extension text) returns void language plpgsql security definer set search_path='' as $$
declare quota bigint; used bigint;
begin
 perform 1 from public.workspaces where id=wid for update;
 if auth.uid() is null or not public.agent_actor_allowed(wid,cid,auth.uid()) then raise exception 'Upload access denied.'; end if;
 if rid is null or amount is null or amount not between 1 and 10616832 or extension not in ('png','jpg','jpeg','webp','gif','mp4','pdf') then raise exception 'Invalid upload reservation.'; end if;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into used from storage.objects where bucket_id='grailhiiv-assets' and split_part(name,'/',1)=wid::text;
 select coalesce(asset_quota_bytes,1073741824) into quota from public.workspace_operations where workspace_id=wid;
 quota:=coalesce(quota,1073741824);
 used:=used+coalesce((select sum(greatest(a.bytes-coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o where o.bucket_id='grailhiiv-assets' and o.name=any(a.paths)),0),0)) from public.asset_uploads a where a.workspace_id=wid),0);
 if used+amount>quota then raise exception 'Workspace upload quota reached.'; end if;
 insert into public.asset_uploads(id,workspace_id,client_id,actor_id,bytes,paths) values(rid,wid,cid,auth.uid(),amount,
 array[wid::text||'/'||cid||'/'||rid::text||'.'||extension,wid::text||'/'||cid||'/'||rid::text||'-thumb.webp']);
end $$;
create function public.asset_upload_allowed(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.asset_uploads where actor_id=auth.uid() and expires_at>now() and path=any(paths)
 and public.agent_actor_allowed(workspace_id,client_id,auth.uid()))
$$;
create function public.release_asset_upload(wid uuid,rid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.asset_uploads where id=rid and workspace_id=wid and actor_id=auth.uid();
end $$;
drop policy grailhiiv_asset_insert on storage.objects;
create policy grailhiiv_asset_insert on storage.objects for insert to authenticated with check(bucket_id='grailhiiv-assets' and public.asset_upload_allowed(name));
-- Thumbnail reads enforce the same client and metadata authorization as originals.
drop policy grailhiiv_asset_read on storage.objects;
create policy grailhiiv_asset_read on storage.objects for select to authenticated using(bucket_id='grailhiiv-assets' and exists(
 select 1 from public.records r where r.kind='assets' and (r.payload->>'storagePath'=name or r.payload->>'thumbnailPath'=name)
 and public.valid_asset_storage(r.workspace_id,r.client_id,r.payload) and public.can_access_client(r.workspace_id,r.client_id)));
create or replace function public.enqueue_agent(wid uuid,cid text,request_id uuid,model_config jsonb,prompt text) returns uuid
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
  if octet_length(model_config::text)>4096 or exists(select 1 from jsonb_object_keys(model_config) k where k not in ('key','label','provider','model','maxTokens','reasoningEffort','inputPricePerMillion','outputPricePerMillion')) then raise exception 'Invalid model configuration.'; end if;
  select * into old from public.agent_runs where id=request_id;
  if old.id is not null then
    if old.workspace_id=wid and old.client_id=cid and old.actor_id=auth.uid() and old.brief=prompt and old.model_config=enqueue_agent.model_config then return request_id; end if;
    raise exception 'Request ID is already in use.';
  end if;
  if exists(select 1 from public.agent_runs where workspace_id=wid and client_id=cid and status in ('Queued','Running','Awaiting approval')) then raise exception 'Review or wait for the active AI run first.'; end if;
  if (select count(*) from public.agent_runs where workspace_id=wid and created_at>now()-interval '1 hour')>=(select coalesce(max(hourly_ai_calls),30) from public.workspace_operations where workspace_id=wid) then raise exception 'Hourly AI run limit reached.'; end if;
  insert into public.agent_runs(id,workspace_id,client_id,actor_id,model_key,model_config,brief)
    values(request_id,wid,cid,auth.uid(),model_config->>'key',model_config,prompt);
  return request_id;
end $$;

create function public.fail_agent(rid uuid,lease_token uuid,code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if code not in ('hourly_limit','daily_tokens','daily_budget','generation_failed') then raise exception 'Invalid failure code.'; end if;
 perform public.finish_agent(rid,lease_token,'Failed',null);
 update public.agent_runs set detail=case code when 'hourly_limit' then 'Hourly AI call limit reached. Retry later or change the workspace limit.'
 when 'daily_tokens' then 'Daily AI token limit reached. Retry tomorrow or change the workspace limit.'
 when 'daily_budget' then 'Daily AI budget reached or model prices are missing. Review AI preferences.'
 else 'Generation failed. Check provider credentials and availability before retrying.' end where id=rid;
end $$;
revoke execute on function public.fail_agent(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_agent(uuid,uuid,text) to service_role;
create function public.expired_asset_uploads() returns setof public.asset_uploads language sql security definer set search_path='' as $$
 select a.* from public.asset_uploads a where expires_at<now() and not exists(select 1 from public.records r where r.workspace_id=a.workspace_id and r.kind='assets' and r.id=a.id::text) limit 50
$$;

create function public.save_internal_rule(wid uuid,rid uuid,rule jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.workspaces where id=wid for update;
 if auth.uid() is null or public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can configure internal automation.'; end if;
 if rid is null and (select count(*) from public.internal_rules where workspace_id=wid)>=50 then raise exception 'Internal rule limit reached. Reuse or disable an existing rule.'; end if;
 if rid is not null and not exists(select 1 from public.internal_rules where id=rid and workspace_id=wid and client_id=rule->>'client_id') then raise exception 'Rule not found or client changed.'; end if;
 result:=coalesce(rid,gen_random_uuid());
 insert into public.internal_rules(id,workspace_id,client_id,actor_id,name,event,action,message,interval_minutes,due_days,enabled,next_run)
 values(result,wid,rule->>'client_id',auth.uid(),rule->>'name',rule->>'event',rule->>'action',rule->>'message',
 (rule->>'interval_minutes')::integer,(rule->>'due_days')::integer,(rule->>'enabled')::boolean,now()+((rule->>'interval_minutes')::integer*interval '1 minute'))
 on conflict(id) do update set name=excluded.name,event=excluded.event,action=excluded.action,message=excluded.message,interval_minutes=excluded.interval_minutes,
 due_days=excluded.due_days,enabled=excluded.enabled,actor_id=excluded.actor_id,next_run=excluded.next_run;
 return result;
end $$;
create function public.queue_internal_event() returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text;
begin
 if new.kind='leads' and tg_op='INSERT' then event_name:='lead_created';
 elsif new.kind='posts' and new.payload->>'status'='Scheduled' and tg_op='UPDATE' and old.payload->>'status' is distinct from 'Scheduled' then event_name:='post_approved';
 else return new; end if;
 insert into public.internal_runs(rule_id,workspace_id,client_id,event_key,record_id)
 select id,new.workspace_id,new.client_id,new.id||':'||new.revision,new.id from public.internal_rules
 where workspace_id=new.workspace_id and client_id=new.client_id and enabled and event=event_name on conflict(rule_id,event_key) do nothing;
 return new;
end $$;
create trigger internal_events after insert or update on public.records for each row execute function public.queue_internal_event();
create function public.tick_internal_automations() returns integer language plpgsql security definer set search_path='' as $$
declare rule public.internal_rules; job public.internal_runs; lead public.records; count_done integer:=0; task jsonb; due text;
begin
 for rule in select * from public.internal_rules where enabled and event='schedule' and next_run<=now() limit 30 loop
 perform 1 from public.workspaces where id=rule.workspace_id for update skip locked;
 if not found then continue; end if;
 select * into rule from public.internal_rules where id=rule.id and enabled and next_run<=now() for update skip locked;
 if not found then continue; end if;
 insert into public.internal_runs(rule_id,workspace_id,client_id,event_key) values(rule.id,rule.workspace_id,rule.client_id,rule.next_run::text) on conflict do nothing;
 update public.internal_rules set next_run=now()+interval_minutes*interval '1 minute' where id=rule.id;
 end loop;
 for job in select * from public.internal_runs where status='Queued' order by created_at limit 30 loop
 perform 1 from public.workspaces where id=job.workspace_id for update skip locked;
 if not found then continue; end if;
 select * into job from public.internal_runs where id=job.id and status='Queued' for update skip locked;
 if not found then continue; end if;
 begin
 select * into rule from public.internal_rules where id=job.rule_id;
 if not rule.enabled or not exists(select 1 from public.workspace_members where workspace_id=job.workspace_id and user_id=rule.actor_id and role='owner') then raise exception 'Rule disabled or owner access revoked.'; end if;
 if job.attempts>=3 then raise exception 'Retry limit reached.'; end if;
 if rule.action='followup' then
 select * into lead from public.records where workspace_id=job.workspace_id and client_id=job.client_id and kind='leads' and id=job.record_id;
 if lead.id is null then raise exception 'Lead is unavailable.'; end if;
 due:=to_char((now() at time zone coalesce((select payload->>'timezone' from public.clients where workspace_id=job.workspace_id and id=job.client_id),'UTC'))::date+rule.due_days,'YYYY-MM-DD');
 if coalesce(lead.payload->>'task','')='' then
 task:=jsonb_build_object('id',lead.id,'clientId',job.client_id,'leadId',lead.id,'text',rule.message,'due',due);
 insert into public.records(workspace_id,kind,id,client_id,payload) values(job.workspace_id,'tasks',task->>'id',job.client_id,task) on conflict(workspace_id,kind,id) do update set payload=excluded.payload,revision=public.records.revision+1;
 update public.records set payload=jsonb_set(jsonb_set(payload,'{task}',to_jsonb(rule.message)),'{due}',to_jsonb(due)),revision=revision+1 where workspace_id=job.workspace_id and kind='leads' and id=lead.id;
 end if;
 end if;
 insert into public.activity_log(workspace_id,client_id,actor_id,summary) values(job.workspace_id,job.client_id,rule.actor_id,'Internal automation: '||rule.name||' — '||rule.message);
 update public.internal_runs set status='Success',detail=case when rule.action='followup' and coalesce(lead.payload->>'task','')<>'' then 'Existing follow-up task preserved.' when rule.action='followup' then 'Follow-up task created.' else 'Workspace activity recorded.' end,attempts=attempts+1,finished_at=now() where id=job.id;
 count_done:=count_done+1;
 exception when others then
 update public.internal_runs set status='Failed',detail='Internal action failed, target unavailable, or access revoked.',attempts=attempts+1,finished_at=now() where id=job.id;
 end;
 end loop;
 return count_done;
end $$;
create function public.retry_internal_run(wid uuid,rid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can retry internal runs.'; end if;
 update public.internal_runs set status='Queued',detail='Retry queued.',finished_at=null where id=rid and workspace_id=wid and status='Failed' and attempts<3;
 if not found then raise exception 'Run cannot be retried.'; end if;
end $$;
create function public.backup_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb:='{}'::jsonb; name text; rows jsonb;
begin
 foreach name in array array['workspaces','workspace_members','clients','client_access','records','approvals','activity_log','workspace_invitations',
 'automation_bindings','automation_runs','agent_runs','workspace_operations','agent_usage','internal_rules','internal_runs'] loop
 execute format('select coalesce(jsonb_agg(t),%L::jsonb) from public.%I t','[]',name) into rows;
 result:=result||jsonb_build_object(name,rows);
 end loop;
 select coalesce(jsonb_agg(u),'[]'::jsonb) into rows from auth.users u where u.id in (
 select user_id from public.workspace_members union select actor_id from public.activity_log union select actor_id from public.approvals
 union select actor_id from public.agent_runs union select actor_id from public.automation_runs union select invited_by from public.workspace_invitations);
 result:=result||jsonb_build_object('auth_users',rows);
 rows:='[]'::jsonb;
 if to_regclass('auth.identities') is not null then execute 'select coalesce(jsonb_agg(i),''[]''::jsonb) from auth.identities i where exists(select 1 from public.workspace_members m where m.user_id=i.user_id)' into rows; end if;
 result:=result||jsonb_build_object('auth_identities',rows);
 return jsonb_build_object('version',1,'created_at',now(),'tables',result);
end $$;
-- Explicit function permissions. No direct authenticated writes are added.
revoke execute on function public.save_operations(uuid,jsonb),public.worker_heartbeat(text,boolean,text),public.reserve_agent_call(uuid,uuid),
 public.report_agent_usage(uuid,uuid,integer,integer),public.valid_agent_plan(uuid,text,jsonb),public.edit_agent_plan(uuid,uuid,jsonb,jsonb),
 public.decide_agent(uuid,uuid,boolean,jsonb),public.regenerate_agent_post(uuid,uuid,integer,jsonb,uuid),public.retry_agent(uuid,uuid),
 public.reserve_asset_upload(uuid,text,uuid,bigint,text),public.asset_upload_allowed(text),public.release_asset_upload(uuid,uuid),
 public.expired_asset_uploads(),public.save_internal_rule(uuid,uuid,jsonb),public.queue_internal_event(),public.tick_internal_automations(),
 public.retry_internal_run(uuid,uuid),public.backup_snapshot() from public,anon,authenticated;
grant execute on function public.save_operations(uuid,jsonb),public.edit_agent_plan(uuid,uuid,jsonb,jsonb),public.decide_agent(uuid,uuid,boolean,jsonb),
 public.regenerate_agent_post(uuid,uuid,integer,jsonb,uuid),public.retry_agent(uuid,uuid),public.reserve_asset_upload(uuid,text,uuid,bigint,text),
 public.asset_upload_allowed(text),public.release_asset_upload(uuid,uuid),public.save_internal_rule(uuid,uuid,jsonb),public.retry_internal_run(uuid,uuid) to authenticated;
grant execute on function public.worker_heartbeat(text,boolean,text),public.reserve_agent_call(uuid,uuid),public.report_agent_usage(uuid,uuid,integer,integer),
 public.expired_asset_uploads(),public.tick_internal_automations(),public.backup_snapshot() to service_role;
create or replace function public.finish_agent(run_id uuid,token uuid,outcome text,plan jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs; p jsonb; idx integer:=0; post jsonb;
begin
  select * into job from public.agent_runs where id=run_id;
  perform 1 from public.workspaces where id=job.workspace_id for update;
  select * into job from public.agent_runs where id=run_id for update;
  if job.status is distinct from 'Running' or token is null or job.lease is distinct from token or job.lease_until<now() then raise exception 'Agent lease expired.'; end if;
  if not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id) or (job.changed_by is not null and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.changed_by)) then raise exception 'Client access revoked.'; end if;
  if outcome='Awaiting approval' then
    if job.decision is not null or not public.valid_agent_plan(job.workspace_id,job.client_id,plan) then raise exception 'Invalid proposal.'; end if;
    for p in select value from jsonb_array_elements(plan->'posts') loop
      if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'title') is distinct from 'string' or length(trim(p->>'title')) not between 1 and 200
        or jsonb_typeof(p->'caption') is distinct from 'string' or length(trim(p->>'caption')) not between 1 and 5000
        or coalesce(p->>'platform','') not in ('Instagram','Facebook','LinkedIn','TikTok','X') then raise exception 'Invalid proposal.'; end if;
    end loop;
    update public.agent_runs set proposal=plan,status=outcome,detail='Review the generated captions before creating drafts.',lease=null,lease_until=null where id=run_id;
  elsif outcome='Completed' then
    if job.decision is distinct from true or not public.valid_agent_plan(job.workspace_id,job.client_id,job.proposal) or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.decided_by) then raise exception 'Human draft acceptance required.'; end if;
    for p in select value from jsonb_array_elements(job.proposal->'posts') loop
      idx:=idx+1;
      post:=jsonb_build_object('id','ai-'||job.id::text||'-'||idx,'clientId',job.client_id,'title',p->>'title','caption',p->>'caption','platform',p->>'platform',
        'date',coalesce(p->>'date',''),'time',coalesce(p->>'time','09:00'),'status','Draft','assetId',coalesce(p->>'assetId',''),'notes','[]'::jsonb);
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
create function public.checkpoint_cleanup_candidates() returns table(id uuid,workspace_id uuid,generation_seq integer) language sql security definer set search_path='' as $$
 select r.id,r.workspace_id,r.generation_seq from public.agent_runs r left join public.workspace_operations o on o.workspace_id=r.workspace_id
 where r.status in ('Completed','Rejected','Failed') and r.finished_at<now()-coalesce(o.checkpoint_days,30)*interval '1 day' and r.checkpoint_pruned_at is null limit 50
$$;
alter function public.valid_asset_storage(uuid,text,jsonb) rename to valid_asset_storage_base;
revoke execute on function public.valid_asset_storage_base(uuid,text,jsonb) from public,anon,authenticated;
create function public.valid_asset_storage(wid uuid,cid text,p jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not public.valid_asset_storage_base(wid,cid,p) then return false; end if;
 if auth.uid() is not null and not public.can_access_client(wid,cid) then return false; end if;
 if p->>'uploaded'='true' and not exists(select 1 from storage.objects where bucket_id='grailhiiv-assets' and name=p->>'storagePath' and (metadata->>'size')::bigint=(p->>'size')::bigint) then return false; end if;
 if p ? 'thumbnailPath' then
 if p->>'uploaded'<>'true' or jsonb_typeof(p->'thumbnailPath') is distinct from 'string' or jsonb_typeof(p->'thumbnailSize') is distinct from 'number'
 or (p->>'thumbnailSize')::bigint not between 1 and 131072
 or split_part(p->>'thumbnailPath','/',1)<>wid::text or split_part(p->>'thumbnailPath','/',2)<>cid
 or array_length(string_to_array(p->>'thumbnailPath','/'),1)<>3 or split_part(p->>'thumbnailPath','/',3) !~ '^[a-zA-Z0-9_-]+-thumb\.webp$'
 or not exists(select 1 from storage.objects where bucket_id='grailhiiv-assets' and name=p->>'thumbnailPath' and (metadata->>'size')::bigint=(p->>'thumbnailSize')::bigint) then return false; end if;
 elsif p ? 'thumbnailSize' then return false; end if;
 return true;
exception when others then return false;
end $$;
revoke execute on function public.valid_asset_storage(uuid,text,jsonb),public.checkpoint_cleanup_candidates() from public,anon,authenticated;
grant execute on function public.valid_asset_storage(uuid,text,jsonb) to authenticated;
grant execute on function public.checkpoint_cleanup_candidates() to service_role;
create function public.operations_usage_summary(wid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; bytes bigint;
begin
 if auth.uid() is null or public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can view operational usage.'; end if;
 select jsonb_build_object('tokens',coalesce(sum(input_tokens+output_tokens),0),'reserved',coalesce(sum(case when input_tokens is null then reserved_tokens else 0 end),0),
 'cost',coalesce(sum(estimated_cost),0),'unpriced',count(*) filter(where input_tokens is not null and estimated_cost is null)) into result
 from public.agent_usage where workspace_id=wid and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into bytes from storage.objects where bucket_id='grailhiiv-assets' and split_part(name,'/',1)=wid::text;
 return result||jsonb_build_object('asset_bytes',bytes);
end $$;
revoke execute on function public.operations_usage_summary(uuid) from public,anon,authenticated;
grant execute on function public.operations_usage_summary(uuid) to authenticated;
create function public.asset_upload_allowed(path text,amount bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare reservation public.asset_uploads; quota bigint; used bigint;
begin
 select * into reservation from public.asset_uploads where actor_id=auth.uid() and expires_at>now() and path=any(paths);
 if reservation.id is null or not public.agent_actor_allowed(reservation.workspace_id,reservation.client_id,auth.uid()) or amount is null or amount<0 or amount>reservation.bytes then return false; end if;
 perform 1 from public.workspaces where id=reservation.workspace_id for update;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into used from storage.objects where bucket_id='grailhiiv-assets' and split_part(name,'/',1)=reservation.workspace_id::text;
 select coalesce(max(asset_quota_bytes),1073741824) into quota from public.workspace_operations where workspace_id=reservation.workspace_id;
 return used+amount<=quota;
end $$;
revoke execute on function public.asset_upload_allowed(text,bigint) from public,anon,authenticated;
grant execute on function public.asset_upload_allowed(text,bigint) to authenticated;
drop policy grailhiiv_asset_insert on storage.objects;
create policy grailhiiv_asset_insert on storage.objects for insert to authenticated with check(bucket_id='grailhiiv-assets' and public.asset_upload_allowed(name,coalesce((metadata->>'size')::bigint,0)));
create function public.prepare_agent_config(rid uuid,lease_token uuid,config jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare effort text;
begin
 select o.reasoning_effort into effort from public.workspace_operations o join public.agent_runs r on r.workspace_id=o.workspace_id where r.id=rid;
 if effort is not null and effort<>'default' and config->>'provider'='openai' and config->>'model' ~ '^gpt-[56]' then config:=jsonb_set(config,'{reasoningEffort}',to_jsonb(effort)); end if;
 update public.agent_runs set model_config=config where id=rid and status='Running' and lease=lease_token and lease_until>now();
 if lease_token is null or not found then raise exception 'Agent lease expired.'; end if;
 return config;
end $$;
revoke execute on function public.prepare_agent_config(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_agent_config(uuid,uuid,jsonb) to service_role;
create or replace function public.claim_agent() returns setof public.agent_runs
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs;
begin
  for job in select * from public.agent_runs where status='Queued' or (status='Running' and lease_until<now()) order by created_at limit 20 loop
    perform 1 from public.workspaces where id=job.workspace_id for update skip locked;
    if not found then continue; end if;
    select * into job from public.agent_runs where id=job.id and (status='Queued' or (status='Running' and lease_until<now())) for update skip locked;
    if not found then continue; end if;
    if (job.changed_by is not null and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.changed_by)) or job.attempts>=3 or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id)
      or (job.decision is true and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.decided_by)) then
      update public.agent_runs set status='Failed',detail='Retry limit reached or client access revoked.',finished_at=now(),lease=null,lease_until=null where id=job.id;
      continue;
    end if;
    update public.agent_runs set status='Running',detail='AI worker processing.',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=job.id returning * into job;
    return next job; return;
  end loop;
end $$;

create or replace function public.agent_context(run_id uuid,token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.agent_runs; brand jsonb;
begin
  select * into job from public.agent_runs where id=run_id;
  if job.status is distinct from 'Running' or job.lease is distinct from token or token is null or job.lease_until<now()
    or not public.agent_actor_allowed(job.workspace_id,job.client_id,job.actor_id) or (job.changed_by is not null and not public.agent_actor_allowed(job.workspace_id,job.client_id,job.changed_by)) then raise exception 'Agent lease or access expired.'; end if;
  select payload into brand from public.clients where workspace_id=job.workspace_id and id=job.client_id;
  return jsonb_build_object('name',brand->>'name','voice',brand->>'voice','audience',brand->>'audience','description',brand->>'description');
end $$;
-- Rebind the read policy to the new validator after the helper rename.
drop policy grailhiiv_asset_read on storage.objects;
create policy grailhiiv_asset_read on storage.objects for select to authenticated using(bucket_id='grailhiiv-assets' and exists(
 select 1 from public.records r where r.kind='assets' and (r.payload->>'storagePath'=name or r.payload->>'thumbnailPath'=name)
 and public.valid_asset_storage(r.workspace_id,r.client_id,r.payload) and public.can_access_client(r.workspace_id,r.client_id)));
