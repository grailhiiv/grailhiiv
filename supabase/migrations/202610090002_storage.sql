insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('grailhiiv-assets','grailhiiv-assets',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','video/mp4','application/pdf']);
-- Folder names are workspace UUID / client ID / generated object UUID.extension.
-- Read requires a visible metadata record; orphan uploads are not downloadable.
create policy grailhiiv_asset_read on storage.objects for select to authenticated using(
  bucket_id='grailhiiv-assets' and exists(
    select 1 from public.records r where r.kind='assets' and r.payload->>'storagePath'=name
      and public.can_access_client(r.workspace_id,r.client_id)
  )
);
create policy grailhiiv_asset_insert on storage.objects for insert to authenticated with check(
  bucket_id='grailhiiv-assets' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and
  public.can_access_client(((storage.foldername(name))[1])::uuid,(storage.foldername(name))[2]) and
  public.workspace_role(((storage.foldername(name))[1])::uuid) in ('owner','team_member')
);
create policy grailhiiv_asset_delete on storage.objects for delete to authenticated using(
  bucket_id='grailhiiv-assets' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and
  public.can_access_client(((storage.foldername(name))[1])::uuid,(storage.foldername(name))[2]) and
  public.workspace_role(((storage.foldername(name))[1])::uuid) in ('owner','team_member')
);
