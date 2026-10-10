-- All data mutations go through narrow authenticated RPCs. Reads use RLS.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','team_member','client_reviewer')),
  notifications boolean not null default true,
  created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create table public.clients (
  workspace_id uuid not null references public.workspaces on delete cascade,
  id text not null, payload jsonb not null,
  check (payload->>'id' = id and jsonb_typeof(payload) = 'object'), primary key(workspace_id,id)
);
create table public.client_access (
  workspace_id uuid not null, user_id uuid not null, client_id text not null,
  primary key(workspace_id,user_id,client_id),
  foreign key(workspace_id,user_id) references public.workspace_members on delete cascade,
  foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create table public.records (
  workspace_id uuid not null, kind text not null check (kind in ('posts','leads','assets','automations','tasks')),
  id text not null, client_id text not null, payload jsonb not null, revision integer not null default 1,
  primary key(workspace_id,kind,id),
  foreign key(workspace_id,client_id) references public.clients on delete cascade,
  check (payload->>'id' = id and payload->>'clientId' = client_id and jsonb_typeof(payload) = 'object')
);
create table public.approvals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  post_id text not null, client_id text not null, revision integer not null,
  decision text not null check(decision in ('Scheduled','Changes requested')),
  actor_id uuid not null references auth.users, content_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,client_id) references public.clients on delete cascade
);
create table public.activity_log (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  client_id text, actor_id uuid not null references auth.users, summary text not null,
  created_at timestamptz not null default now()
);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null, role text not null check(role in ('team_member','client_reviewer')),
  client_ids text[] not null, invited_by uuid not null references auth.users,
  expires_at timestamptz not null default now() + interval '7 days', accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitation_pending_email on public.workspace_invitations(workspace_id,lower(email)) where accepted_at is null;
create index members_user on public.workspace_members(user_id);
create index records_client on public.records(workspace_id,client_id);
create index activity_client on public.activity_log(workspace_id,client_id,created_at desc);

create function public.workspace_role(wid uuid) returns text language sql stable security definer set search_path = '' as $$
  select role from public.workspace_members where workspace_id = wid and user_id = auth.uid()
$$;
create function public.can_access_client(wid uuid, cid text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.workspace_role(wid) = 'owner',false) or exists(
    select 1 from public.client_access where workspace_id = wid and client_id = cid and user_id = auth.uid()
  )
$$;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_access enable row level security;
alter table public.records enable row level security;
alter table public.approvals enable row level security;
alter table public.activity_log enable row level security;
alter table public.workspace_invitations enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.workspace_role(id) is not null);
create policy member_read on public.workspace_members for select to authenticated using(user_id = auth.uid() or public.workspace_role(workspace_id) = 'owner');
create policy client_read on public.clients for select to authenticated using(public.can_access_client(workspace_id,id));
create policy access_read on public.client_access for select to authenticated using(user_id = auth.uid() or public.workspace_role(workspace_id) = 'owner');
create policy record_read on public.records for select to authenticated using(public.can_access_client(workspace_id,client_id) and (public.workspace_role(workspace_id) <> 'client_reviewer' or kind in ('posts','assets')));
create policy approval_read on public.approvals for select to authenticated using(public.can_access_client(workspace_id,client_id));
create policy activity_read on public.activity_log for select to authenticated using(
  public.workspace_role(workspace_id) = 'owner' or (client_id is not null and public.can_access_client(workspace_id,client_id) and
  (public.workspace_role(workspace_id) <> 'client_reviewer' or summary like 'posts %'))
);
create policy invitation_read on public.workspace_invitations for select to authenticated using(public.workspace_role(workspace_id) = 'owner');
revoke all on public.workspaces, public.workspace_members, public.clients, public.client_access, public.records, public.approvals, public.activity_log, public.workspace_invitations from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.clients, public.client_access, public.records, public.approvals, public.activity_log, public.workspace_invitations to authenticated;

create function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  if length(trim(workspace_name)) not between 1 and 200 then raise exception 'Workspace name is required (maximum 200 characters).'; end if;
  insert into public.workspaces(name) values(trim(workspace_name)) returning id into wid;
  insert into public.workspace_members(workspace_id,user_id,role) values(wid,auth.uid(),'owner');
  return wid;
end $$;

create function public.create_invitation(wid uuid, invite_email text, invite_role text, assigned_clients text[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; cid text;
begin
  if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can invite members.'; end if;
  if invite_role not in ('team_member','client_reviewer') or invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid invitation.'; end if;
  if coalesce(cardinality(assigned_clients),0) = 0 then raise exception 'Assign at least one client.'; end if;
  foreach cid in array assigned_clients loop
    if not exists(select 1 from public.clients where workspace_id=wid and id=cid) then raise exception 'Client does not belong to this workspace.'; end if;
  end loop;
  if exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=wid and lower(u.email)=lower(trim(invite_email))) then raise exception 'This user is already a member. Edit their access instead.'; end if;
  delete from public.workspace_invitations where workspace_id=wid and lower(email)=lower(trim(invite_email)) and accepted_at is null and expires_at < now();
  insert into public.workspace_invitations(workspace_id,email,role,client_ids,invited_by) values(wid,lower(trim(invite_email)),invite_role,assigned_clients,auth.uid()) returning id into result;
  insert into public.activity_log(workspace_id,actor_id,summary) values(wid,auth.uid(),'Member invited: ' || lower(trim(invite_email)));
  return result;
end $$;

create function public.accept_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.workspace_invitations; user_email text;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
  select lower(email) into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if user_email is null then return; end if;
  for invitation in select * from public.workspace_invitations where lower(email)=user_email and accepted_at is null and expires_at>now() for update loop
    insert into public.workspace_members(workspace_id,user_id,role) values(invitation.workspace_id,auth.uid(),invitation.role) on conflict do nothing;
    insert into public.client_access(workspace_id,user_id,client_id)
      select invitation.workspace_id,auth.uid(),c.id from public.clients c where c.workspace_id=invitation.workspace_id and c.id=any(invitation.client_ids) on conflict do nothing;
    update public.workspace_invitations set accepted_at=now() where id=invitation.id;
  end loop;
end $$;

create function public.manage_member(wid uuid, member_id uuid, member_role text, assigned_clients text[], remove_member boolean default false) returns void language plpgsql security definer set search_path = '' as $$
declare cid text;
begin
  if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can manage members.'; end if;
  if member_id = auth.uid() then raise exception 'You cannot change your own owner access.'; end if;
  if member_role not in ('owner','team_member','client_reviewer') then raise exception 'Invalid role.'; end if;
  if not exists(select 1 from public.workspace_members where workspace_id=wid and user_id=member_id) then raise exception 'Member not found.'; end if;
  if remove_member then
    delete from public.workspace_members where workspace_id=wid and user_id=member_id;
  else
    foreach cid in array coalesce(assigned_clients,array[]::text[]) loop
      if not exists(select 1 from public.clients where workspace_id=wid and id=cid) then raise exception 'Invalid client assignment.'; end if;
    end loop;
    update public.workspace_members set role=member_role where workspace_id=wid and user_id=member_id;
    delete from public.client_access where workspace_id=wid and user_id=member_id;
    insert into public.client_access select wid,member_id,unnest(coalesce(assigned_clients,array[]::text[]));
  end if;
  insert into public.activity_log(workspace_id,actor_id,summary) values(wid,auth.uid(),'Member access updated: ' || member_id::text);
end $$;

create function public.revoke_invitation(wid uuid, invitation_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can revoke invitations.'; end if;
  delete from public.workspace_invitations where workspace_id=wid and id=invitation_id and accepted_at is null;
end $$;

create function public.commit_records(wid uuid, changes jsonb, prefs jsonb default null) returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; item jsonb; old_payload jsonb; next_payload jsonb; cid text; item_kind text; item_id text; rev integer; old_status text; next_status text;
begin
  actor_role := public.workspace_role(wid);
  if actor_role is null then raise exception 'Workspace access denied.'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes)>500 then raise exception 'Invalid changes.'; end if;
  -- Serialize commits within this workspace; stale record payloads still produce a conflict.
  perform 1 from public.workspaces where id=wid for update;
  for item in select value from jsonb_array_elements(changes) loop
    item_kind := item->>'kind'; item_id := item->>'id'; old_payload := null; rev := 0;
    next_payload := nullif(item->'after','null'::jsonb);
    if item_kind not in ('clients','posts','leads','assets','automations') or item_id is null or item_id !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid record.'; end if;
    if item_kind = 'clients' then
      if actor_role <> 'owner' then raise exception 'Only owners can edit clients.'; end if;
      select payload into old_payload from public.clients where workspace_id=wid and id=item_id;
      cid := item_id;
    else
      select payload,revision into old_payload,rev from public.records where workspace_id=wid and kind=item_kind and id=item_id;
      cid := coalesce(old_payload->>'clientId',next_payload->>'clientId');
      if not public.can_access_client(wid,cid) then raise exception 'Client access denied.'; end if;
      if next_payload is not null and next_payload->>'clientId' is distinct from cid then raise exception 'Records cannot move between clients.'; end if;
    end if;
    if old_payload is distinct from nullif(item->'before','null'::jsonb) then raise exception 'This record changed on another device. Reload and retry.'; end if;
    if next_payload is not null and (jsonb_typeof(next_payload) <> 'object' or next_payload->>'id' is distinct from item_id) then raise exception 'Invalid payload.'; end if;
    if next_payload is not null and octet_length(next_payload::text)>100000 then raise exception 'Record is too large.'; end if;
    if actor_role='client_reviewer' then
      if item_kind <> 'posts' or old_payload is null or next_payload is null then raise exception 'Reviewers may only review existing posts.'; end if;
      if (next_payload - 'status' - 'notes') is distinct from (old_payload - 'status' - 'notes') then raise exception 'Reviewers cannot edit content.'; end if;
      if jsonb_typeof(next_payload->'notes') <> 'array' or jsonb_array_length(next_payload->'notes') < jsonb_array_length(old_payload->'notes') or
        (select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(next_payload->'notes') with ordinality as n(value,num) where num <= jsonb_array_length(old_payload->'notes')) is distinct from old_payload->'notes'
        then raise exception 'Existing feedback cannot be changed.'; end if;
      if next_payload->>'status' is distinct from old_payload->>'status' and
        (old_payload->>'status' <> 'Awaiting approval' or next_payload->>'status' not in ('Scheduled','Changes requested')) then raise exception 'Submit the post for review first.'; end if;
    end if;
    if item_kind='posts' and next_payload is not null then
      old_status := old_payload->>'status'; next_status := next_payload->>'status';
      if next_status not in ('Draft','Awaiting approval','Changes requested','Scheduled') then raise exception 'Publishing is not connected.'; end if;
      if old_status = 'Published' then raise exception 'Published posts cannot be edited.'; end if;
      if next_payload->>'assetId' <> '' and not exists(select 1 from public.records where workspace_id=wid and kind='assets' and id=next_payload->>'assetId' and client_id=cid) then raise exception 'Choose an asset from this client.'; end if;
      if old_payload is null and next_status <> 'Draft' then raise exception 'New posts must be drafts.'; end if;
      if old_payload is not null and (next_payload - 'status' - 'notes' - 'metrics') is distinct from (old_payload - 'status' - 'notes' - 'metrics') and next_status <> 'Draft' then raise exception 'Content edits must return to Draft for approval.'; end if;
      if next_status='Scheduled' then
        if coalesce(next_payload->>'date','')='' or coalesce(next_payload->>'time','')='' then raise exception 'Choose a date and time before scheduling.'; end if;
        if old_status is distinct from 'Scheduled' then
          if actor_role='team_member' and exists(select 1 from public.clients where workspace_id=wid and id=cid and coalesce((payload->>'approvalRequired')::boolean,true)) then raise exception 'An owner or client reviewer must approve this version.'; end if;
          if actor_role in ('owner','client_reviewer') and old_status <> 'Awaiting approval' then raise exception 'Submit this post for review first.'; end if;
        end if;
      end if;
      if next_status='Changes requested' and old_status is distinct from next_status and (actor_role='team_member' or old_status <> 'Awaiting approval') then raise exception 'Only a reviewer or owner can request changes on submitted posts.'; end if;
    end if;
    if item_kind='assets' and next_payload is not null and (next_payload->>'uploaded')::boolean then
      if next_payload->>'storagePath' is null or next_payload->>'storagePath' not like wid::text || '/' || cid || '/%' then raise exception 'Asset storage path does not belong to this client.'; end if;
      if not exists(select 1 from storage.objects where bucket_id='grailhiiv-assets' and name=next_payload->>'storagePath') then raise exception 'Upload the file before saving its metadata.'; end if;
    end if;
    if item_kind='clients' then
      if next_payload is null then delete from public.clients where workspace_id=wid and id=item_id;
      else insert into public.clients values(wid,item_id,next_payload) on conflict(workspace_id,id) do update set payload=excluded.payload; end if;
    else
      if next_payload is null then delete from public.records where workspace_id=wid and kind=item_kind and id=item_id;
      else insert into public.records values(wid,item_kind,item_id,cid,next_payload,coalesce(rev,0)+1) on conflict(workspace_id,kind,id) do update set payload=excluded.payload,revision=excluded.revision; end if;
      if item_kind='leads' then
        delete from public.records where workspace_id=wid and kind='tasks' and id=item_id;
        if coalesce(next_payload->>'task','') <> '' then
          insert into public.records values(wid,'tasks',item_id,cid,jsonb_build_object('id',item_id,'clientId',cid,'leadId',item_id,'text',next_payload->>'task','due',next_payload->>'due'),coalesce(rev,0)+1);
        end if;
      end if;
      if item_kind='posts' and next_payload->>'status' in ('Scheduled','Changes requested') and next_payload->>'status' is distinct from old_payload->>'status' then
        insert into public.approvals(workspace_id,post_id,client_id,revision,decision,actor_id,content_snapshot) values(wid,item_id,cid,coalesce(rev,0)+1,next_payload->>'status',auth.uid(),next_payload);
      end if;
    end if;
    insert into public.activity_log(workspace_id,client_id,actor_id,summary) values(wid,cid,auth.uid(),item_kind || ' ' || case when next_payload is null then 'deleted' when old_payload is null then 'created' else 'updated' end || ': ' || coalesce(next_payload->>'title',next_payload->>'name',item_id));
  end loop;
  if prefs is not null then
    if prefs->>'name' is distinct from (select name from public.workspaces where id=wid) then
      if actor_role <> 'owner' then raise exception 'Only owners can edit workspace preferences.'; end if;
      update public.workspaces set name=prefs->>'name' where id=wid;
    end if;
    update public.workspace_members set notifications=(prefs->>'notifications')::boolean where workspace_id=wid and user_id=auth.uid();
  end if;
end $$;

-- SECURITY DEFINER functions default to PUBLIC execution; explicitly narrow it.
revoke execute on function public.workspace_role(uuid), public.can_access_client(uuid,text), public.create_workspace(text), public.create_invitation(uuid,text,text,text[]), public.accept_invitations(), public.manage_member(uuid,uuid,text,text[],boolean), public.revoke_invitation(uuid,uuid), public.commit_records(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.workspace_role(uuid), public.can_access_client(uuid,text), public.create_workspace(text), public.create_invitation(uuid,text,text,text[]), public.accept_invitations(), public.manage_member(uuid,uuid,text,text[],boolean), public.revoke_invitation(uuid,uuid), public.commit_records(uuid,jsonb,jsonb) to authenticated;
