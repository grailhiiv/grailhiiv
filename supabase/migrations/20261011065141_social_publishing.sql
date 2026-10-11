-- Credentials and transient authorization material are service-only.
alter table public.worker_status drop constraint worker_status_name_check;
alter table public.worker_status add constraint worker_status_name_check check(name in ('ai','n8n','internal','backup','social'));
create table public.social_connections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
 client_id text not null, platform text not null check(platform in ('Facebook','Instagram')),
 account_id text not null check(account_id ~ '^[0-9]+$'), account_name text not null,
 token_cipher text not null, actor_id uuid not null references auth.users,
 enabled boolean not null default false, created_at timestamptz not null default now(),
 foreign key(workspace_id,client_id) references public.clients on delete cascade,
 unique(workspace_id,client_id,platform)
);
create table public.social_oauth (
 id text primary key, workspace_id uuid not null references public.workspaces on delete cascade,
 client_id text not null, actor_id uuid not null references auth.users, platform text not null default 'Facebook' check(platform in ('Facebook','Instagram')),
 pages_cipher text, expires_at timestamptz not null default now()+interval '15 minutes',
 foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create index social_oauth_expiry on public.social_oauth(expires_at);
create table public.publish_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
 client_id text not null, post_id text not null, approval_id uuid not null references public.approvals,
 connection_id uuid references public.social_connections on delete set null,
 snapshot jsonb not null, asset_snapshot jsonb, timezone text not null, due_at timestamptz not null,
 state text not null default 'Queued' check(state in ('Queued','Preparing','Sending','Published','Failed','Needs review','Cancelled')),
 lease uuid, lease_until timestamptz, container_id text, provider_id text, detail text not null default '',
 created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(workspace_id,client_id) references public.clients on delete cascade,
 unique(workspace_id,post_id,approval_id)
);
create index publish_jobs_queue on public.publish_jobs(due_at,created_at) where state='Queued';
create index publish_jobs_workspace on public.publish_jobs(workspace_id,created_at desc);
create index publish_jobs_connection on public.publish_jobs(connection_id);
create unique index publish_jobs_receipt on public.publish_jobs(connection_id,provider_id) where provider_id is not null;
alter table public.social_connections enable row level security;
alter table public.social_oauth enable row level security;
alter table public.publish_jobs enable row level security;
revoke all on public.social_connections,public.social_oauth,public.publish_jobs from public,anon,authenticated;
grant all on public.social_connections,public.social_oauth,public.publish_jobs to service_role;
grant select on public.publish_jobs to authenticated;
create policy publishing_read on public.publish_jobs for select to authenticated using(public.can_access_client(workspace_id,client_id));

-- Equality ignores feedback/metrics; every field affecting delivery remains bound.
create function public.publish_content(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select p-'status'-'notes'-'metrics'
$$;
create function public.publishing_valid(j public.publish_jobs) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.records p
 join public.clients c on c.workspace_id=p.workspace_id and c.id=p.client_id
 join public.approvals a on a.id=j.approval_id and a.workspace_id=p.workspace_id and a.post_id=p.id and a.client_id=p.client_id
 join public.social_connections s on s.id=j.connection_id and s.workspace_id=p.workspace_id and s.client_id=p.client_id
 join public.workspace_members m on m.workspace_id=p.workspace_id and m.user_id=a.actor_id
 join public.workspace_members owner on owner.workspace_id=s.workspace_id and owner.user_id=s.actor_id and owner.role='owner'
 where p.workspace_id=j.workspace_id and p.kind='posts' and p.id=j.post_id and p.client_id=j.client_id
 and p.payload->>'status'='Scheduled' and s.enabled and s.platform=p.payload->>'platform'
 and a.decision='Scheduled' and public.publish_content(p.payload)=public.publish_content(a.content_snapshot)
 and public.publish_content(p.payload)=public.publish_content(j.snapshot)
 and c.payload->>'timezone'=j.timezone
 and (m.role='owner' or (exists(select 1 from public.client_access ca where ca.workspace_id=m.workspace_id and ca.user_id=m.user_id and ca.client_id=p.client_id)
 and (m.role='client_reviewer' or (m.role='team_member' and coalesce((c.payload->>'approvalRequired')::boolean,true)=false))))
 and (case when coalesce(p.payload->>'assetId','')='' then j.asset_snapshot is null else exists(
 select 1 from public.records asset where asset.workspace_id=p.workspace_id and asset.kind='assets' and asset.id=p.payload->>'assetId'
 and asset.client_id=p.client_id and asset.payload=j.asset_snapshot and asset.payload->>'status'='Approved'
 and asset.payload->>'uploaded'='true' and exists(select 1 from storage.objects o where o.bucket_id='grailhiiv-assets' and o.name=asset.payload->>'storagePath')) end))
$$;

create function public.save_social_connection(wid uuid,cid text,actor uuid,platform_name text,account text,label text,cipher text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.workspaces where id=wid for update;
 if not exists(select 1 from public.workspace_members where workspace_id=wid and user_id=actor and role='owner') then raise exception 'Only owners can connect accounts.'; end if;
 if exists(select 1 from public.publish_jobs where workspace_id=wid and client_id=cid and snapshot->>'platform'=platform_name and state in ('Sending','Needs review')) then raise exception 'Resolve pending delivery before changing the account.'; end if;
 insert into public.social_connections(workspace_id,client_id,actor_id,platform,account_id,account_name,token_cipher)
 values(wid,cid,actor,platform_name,account,left(label,200),cipher)
 on conflict(workspace_id,client_id,platform) do update set actor_id=actor,account_id=account,account_name=left(label,200),token_cipher=cipher,enabled=false
 returning id into result;
 update public.publish_jobs set state='Cancelled',detail='Account connection changed.' where connection_id=result and state in ('Queued','Preparing','Failed');
 return result;
end $$;
create function public.manage_social_connection(wid uuid,sid uuid,operation text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.workspaces where id=wid for update;
 if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can manage publishing.'; end if;
 if not exists(select 1 from public.social_connections where id=sid and workspace_id=wid) then raise exception 'Account not found.'; end if;
 if exists(select 1 from public.publish_jobs where connection_id=sid and state in ('Sending','Needs review')) then raise exception 'Resolve pending delivery before changing the account.'; end if;
 if operation='enable' then
 update public.social_connections set enabled=true,actor_id=auth.uid() where id=sid;
 elsif operation in ('disable','disconnect') then
 update public.social_connections set enabled=false where id=sid;
 update public.publish_jobs set state='Cancelled',detail='Publishing paused.' where connection_id=sid and state in ('Queued','Preparing');
 if operation='disconnect' then delete from public.social_connections where id=sid; end if;
 else raise exception 'Invalid publishing action.'; end if;
end $$;

-- Opted-in accounts enqueue approved versions. Invalid dates cannot break another client's queue.
create function public.queue_social_posts() returns integer language plpgsql security definer set search_path='' as $$
declare p record; a public.approvals; asset jsonb; zone text; due timestamptz; j public.publish_jobs; total integer:=0;
begin
 delete from public.social_oauth where expires_at<now();
 update public.publish_jobs set state='Needs review',detail='Worker stopped before delivery was confirmed.',finished_at=now() where state='Sending' and lease_until<now();
 update public.publish_jobs set state='Queued',lease=null,lease_until=null where state='Preparing' and lease_until<now();
 for p in select r.*,s.id sid,c.payload client from public.records r join public.social_connections s
 on s.workspace_id=r.workspace_id and s.client_id=r.client_id and s.platform=r.payload->>'platform' and s.enabled
 join public.clients c on c.workspace_id=r.workspace_id and c.id=r.client_id where r.kind='posts' and r.payload->>'status'='Scheduled' loop
 begin
 select * into a from public.approvals where workspace_id=p.workspace_id and post_id=p.id and client_id=p.client_id and decision='Scheduled'
 and public.publish_content(content_snapshot)=public.publish_content(p.payload) order by created_at desc limit 1;
 if a.id is null then continue; end if;
 if exists(select 1 from public.publish_jobs where workspace_id=p.workspace_id and post_id=p.id and (approval_id=a.id or state in ('Sending','Needs review','Published'))) then continue; end if;
 asset:=null;
 if coalesce(p.payload->>'assetId','')<>'' then select payload into asset from public.records where workspace_id=p.workspace_id and kind='assets' and id=p.payload->>'assetId' and client_id=p.client_id; end if;
 zone:=p.client->>'timezone';
 if not exists(select 1 from pg_timezone_names where name=zone) then continue; end if;
 if p.payload->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or p.payload->>'time' !~ '^\d{2}:\d{2}$' then continue; end if;
 due:=((p.payload->>'date')||' '||(p.payload->>'time'))::timestamp at time zone zone;
 -- Never unexpectedly send a backlog when an account is enabled.
 if due<now()-interval '10 minutes' then continue; end if;
 insert into public.publish_jobs(workspace_id,client_id,post_id,approval_id,connection_id,snapshot,asset_snapshot,timezone,due_at)
 values(p.workspace_id,p.client_id,p.id,a.id,p.sid,p.payload,asset,zone,due) on conflict do nothing returning * into j;
 if j.id is not null then total:=total+1; end if;
 exception when datetime_field_overflow or invalid_datetime_format then continue;
 end;
 end loop;
 return total;
end $$;

create function public.claim_publish_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.publish_jobs;
begin
 select * into j from public.publish_jobs where state='Queued' and due_at<=now() order by due_at,created_at for update skip locked limit 1;
 if j.id is null then return null; end if;
 if not public.publishing_valid(j) or j.due_at<now()-interval '1 day' then
 update public.publish_jobs set state='Cancelled',detail='Approval, account, asset or schedule changed.',finished_at=now() where id=j.id; return null;
 end if;
 update public.publish_jobs set state='Preparing',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;

create function public.prepare_publish_job(jid uuid,token uuid,container text default null,send_now boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.publish_jobs; s public.social_connections;
begin
 -- Same workspace lock order as user edits prevents mutation between final validation and Sending.
 perform 1 from public.workspaces w join public.publish_jobs p on p.workspace_id=w.id where p.id=jid for update of w;
 select * into j from public.publish_jobs where id=jid for update;
 if j.id is null or j.state<>'Preparing' or j.lease is distinct from token or j.lease_until<now() then raise exception 'Publishing lease expired.'; end if;
 if not public.publishing_valid(j) then
 update public.publish_jobs set state='Cancelled',detail='Approval, account or asset changed.',finished_at=now() where id=jid; return null;
 end if;
 if container is not null then
 if container !~ '^[0-9]+$' then raise exception 'Invalid container.'; end if;
 update public.publish_jobs set container_id=container where id=jid;
 end if;
 if send_now then update public.publish_jobs set state='Sending',lease_until=now()+interval '5 minutes' where id=jid; end if;
 select * into s from public.social_connections where id=j.connection_id;
 return jsonb_build_object('account_id',s.account_id,'token_cipher',s.token_cipher,'context',s.workspace_id::text||':'||s.client_id||':'||s.platform);
end $$;

create function public.finish_publish_job(jid uuid,token uuid,result_state text,remote_id text default null,reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare j public.publish_jobs;
begin
 perform 1 from public.workspaces w join public.publish_jobs p on p.workspace_id=w.id where p.id=jid for update of w;
 select * into j from public.publish_jobs where id=jid for update;
 if j.lease is distinct from token or j.state not in ('Preparing','Sending','Needs review') then raise exception 'Publishing lease expired.'; end if;
 if result_state not in ('Published','Failed','Needs review','Queued') then raise exception 'Invalid result.'; end if;
 if result_state='Queued' and j.state<>'Preparing' then raise exception 'A delivery cannot be retried automatically.'; end if;
 if result_state='Published' and (j.state not in ('Sending','Needs review') or remote_id is null or remote_id !~ '^[0-9_]+$') then raise exception 'Missing publishing receipt.'; end if;
 update public.publish_jobs set state=result_state,provider_id=remote_id,detail=left(reason,200),
 due_at=case when result_state='Queued' then now()+interval '30 seconds' else due_at end,
 finished_at=case when result_state='Queued' then null else now() end where id=jid;
 if result_state='Published' then
 update public.records set payload=jsonb_set(payload,'{status}','"Published"'::jsonb),revision=revision+1 where workspace_id=j.workspace_id and kind='posts' and id=j.post_id;
 insert into public.activity_log(workspace_id,client_id,actor_id,summary) select j.workspace_id,j.client_id,a.actor_id,'Published content to '||(j.snapshot->>'platform') from public.approvals a where a.id=j.approval_id;
 end if;
end $$;

create function public.review_publish_job(wid uuid,jid uuid,operation text) returns void language plpgsql security definer set search_path='' as $$
declare j public.publish_jobs;
begin
 perform 1 from public.workspaces where id=wid for update;
 if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can review delivery.'; end if;
 select * into j from public.publish_jobs where id=jid and workspace_id=wid for update;
 if j.id is null then raise exception 'Delivery not found.'; end if;
 if ((operation='retry' and j.state in ('Failed','Cancelled')) or (operation='retry_uncertain' and j.state='Needs review')) and public.publishing_valid(j) then
 update public.publish_jobs set state='Queued',due_at=now(),detail='',finished_at=null where id=jid;
 elsif (operation='cancel' and j.state in ('Queued','Preparing','Failed')) or (operation='dismiss_uncertain' and j.state='Needs review') then
 update public.publish_jobs set state='Cancelled',detail='Cancelled by owner.',finished_at=now() where id=jid;
 else raise exception 'Uncertain deliveries must be checked on the platform; automatic retry is blocked.'; end if;
end $$;

-- Freeze delivery-affecting edits during the actual provider request.
create function public.protect_publishing_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.kind in ('posts','assets') and exists(select 1 from public.publish_jobs j where j.workspace_id=old.workspace_id and j.state in ('Sending','Needs review')
 and ((old.kind='posts' and j.post_id=old.id) or (old.kind='assets' and j.snapshot->>'assetId'=old.id))) then
 if tg_op='DELETE' then raise exception 'Publishing is in progress.'; end if;
 if old.kind='assets' or public.publish_content(new.payload) is distinct from public.publish_content(old.payload) or new.payload->>'status' not in ('Scheduled','Published') then raise exception 'Publishing is in progress.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger publishing_record_guard before update or delete on public.records for each row execute function public.protect_publishing_record();

-- Extend existing backup coverage without duplicating its auth/export logic.
alter function public.backup_snapshot() rename to backup_snapshot_before_social;
revoke execute on function public.backup_snapshot_before_social() from public,anon,authenticated;
create function public.backup_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; name text; rows jsonb;
begin
 result:=public.backup_snapshot_before_social();
 foreach name in array array['social_connections','publish_jobs'] loop
 execute format('select coalesce(jsonb_agg(t),%L::jsonb) from public.%I t','[]',name) into rows;
 result:=jsonb_set(result,array['tables',name],rows);
 end loop;
 return result;
end $$;

-- No helper/RPC is implicitly PUBLIC executable.
revoke execute on function public.publish_content(jsonb),public.publishing_valid(public.publish_jobs),public.protect_publishing_record(),
 public.save_social_connection(uuid,text,uuid,text,text,text,text),public.manage_social_connection(uuid,uuid,text),public.queue_social_posts(),
 public.claim_publish_job(),public.prepare_publish_job(uuid,uuid,text,boolean),public.finish_publish_job(uuid,uuid,text,text,text),
 public.review_publish_job(uuid,uuid,text),public.backup_snapshot() from public,anon,authenticated;
grant execute on function public.manage_social_connection(uuid,uuid,text),public.review_publish_job(uuid,uuid,text) to authenticated;
grant execute on function public.publish_content(jsonb),public.publishing_valid(public.publish_jobs),public.save_social_connection(uuid,text,uuid,text,text,text,text),
 public.queue_social_posts(),public.claim_publish_job(),public.prepare_publish_job(uuid,uuid,text,boolean),public.finish_publish_job(uuid,uuid,text,text,text),public.backup_snapshot() to service_role;
