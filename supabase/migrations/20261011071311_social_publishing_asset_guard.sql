-- Approved asset identities cannot be recycled to replace their underlying bytes.
alter function public.asset_upload_allowed(text,bigint) rename to asset_upload_allowed_before_social;
revoke execute on function public.asset_upload_allowed_before_social(text,bigint) from public,anon,authenticated;
create function public.asset_upload_allowed(path text,amount bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare reservation public.asset_uploads;
begin
 if not public.asset_upload_allowed_before_social(path,amount) then return false; end if;
 select * into reservation from public.asset_uploads where actor_id=auth.uid() and expires_at>now() and path=any(paths);
 if reservation.id is null then return false; end if;
 return not exists(select 1 from public.records r where r.workspace_id=reservation.workspace_id and r.kind='assets'
 and (r.id=reservation.id::text or r.payload->>'storagePath'=path or r.payload->>'thumbnailPath'=path))
 and not exists(select 1 from public.approvals a where a.workspace_id=reservation.workspace_id and a.content_snapshot->>'assetId'=reservation.id::text);
end $$;
revoke execute on function public.asset_upload_allowed(text,bigint) from public,anon,authenticated;
grant execute on function public.asset_upload_allowed(text,bigint) to authenticated;
-- Rebind the policy to the wrapper's OID after renaming the previous implementation.
drop policy grailhiiv_asset_insert on storage.objects;
create policy grailhiiv_asset_insert on storage.objects for insert to authenticated with check(bucket_id='grailhiiv-assets' and public.asset_upload_allowed(name,coalesce((metadata->>'size')::bigint,0)));

create function public.protect_publishing_client() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.publish_jobs where workspace_id=old.workspace_id and client_id=old.id and state in ('Sending','Needs review')) then
 raise exception 'Resolve pending delivery before deleting the client.';
 end if;
 return old;
end $$;
revoke execute on function public.protect_publishing_client() from public,anon,authenticated;
create trigger publishing_client_guard before delete on public.clients for each row execute function public.protect_publishing_client();
