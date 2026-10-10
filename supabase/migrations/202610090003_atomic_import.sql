create or replace function public.commit_records(wid uuid, changes jsonb, prefs jsonb default null) returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; item jsonb; old_payload jsonb; next_payload jsonb; cid text; item_kind text; item_id text; rev integer; old_status text; next_status text;
begin
  actor_role := public.workspace_role(wid);
  if actor_role is null then raise exception 'Workspace access denied.'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes)>500 then raise exception 'Invalid changes.'; end if;
  -- Serialize commits within this workspace; stale record payloads still produce a conflict.
  perform 1 from public.workspaces where id=wid for update;
  actor_role := public.workspace_role(wid);
  if actor_role is null then raise exception 'Workspace access denied.'; end if;
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

create function public.import_records(wid uuid, changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.workspace_role(wid) is distinct from 'owner' then raise exception 'Only owners can import browser records.'; end if;
  perform 1 from public.workspaces where id=wid for update;
  if exists(select 1 from public.clients where workspace_id=wid) or exists(select 1 from public.records where workspace_id=wid) then
    raise exception 'Import requires an empty workspace. Existing records will not be overwritten.';
  end if;
  perform public.commit_records(wid,changes,null);
end $$;
revoke execute on function public.import_records(uuid,jsonb) from public,anon;
grant execute on function public.import_records(uuid,jsonb) to authenticated;
