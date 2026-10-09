-- Public sample identities may never move into a real tenant or gain roles.
create policy public_demo_profile_boundary on public.profiles as restrictive for all to authenticated
using (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false or company_id::text = auth.jwt()->'app_metadata'->>'demo_company_id')
with check (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false or company_id::text = auth.jwt()->'app_metadata'->>'demo_company_id');
create policy public_demo_no_role_insert on public.user_roles as restrictive for insert to authenticated
with check (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false);
create policy public_demo_no_role_update on public.user_roles as restrictive for update to authenticated
using (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false)
with check (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false);
create policy public_demo_no_role_delete on public.user_roles as restrictive for delete to authenticated
using (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false);
create policy public_demo_settings_boundary on public.app_settings as restrictive for all to authenticated
using (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false or key like ('company:' || (auth.jwt()->'app_metadata'->>'demo_company_id') || ':%'))
with check (coalesce((auth.jwt()->'app_metadata'->>'public_demo')::boolean,false) = false or key like ('company:' || (auth.jwt()->'app_metadata'->>'demo_company_id') || ':%'));
