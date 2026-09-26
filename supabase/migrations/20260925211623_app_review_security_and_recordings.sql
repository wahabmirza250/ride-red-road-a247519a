-- Membership and role assignment are only changed through guarded server APIs.
revoke insert, update, delete on public.user_roles from public, anon, authenticated;
revoke insert, update, delete on public.profiles from public, anon, authenticated;
grant update (first_name, last_name, email, phone, avatar_url, sms_alerts_enabled)
  on public.profiles to authenticated;

create policy app_settings_company_namespace on public.app_settings
  as restrictive for all to authenticated
  using (key not like 'company:%' or key like 'company:' || public.current_user_company_id()::text || ':%')
  with check (key not like 'company:%' or key like 'company:' || public.current_user_company_id()::text || ':%');

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    left join public.profiles p on p.id = r.user_id
    left join public.companies c on c.id = p.company_id
    where r.user_id = _user_id and r.role = _role
      and ((_role = 'platform_owner' and r.company_id is null)
        or (r.company_id = p.company_id and c.status = 'active'))
  )
$$;
create or replace function public.current_user_has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), _role)
$$;

-- No legacy global auto-assignment value is copied into other companies.
-- Administrators explicitly enable their own company's setting.
create table public.camera_recordings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  driver_id uuid not null references public.drivers(id),
  object_path text not null unique,
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint recording_retention check (expires_at = captured_at + interval '7 days')
);
create index camera_recordings_expiry on public.camera_recordings(expires_at);
create index camera_recordings_driver on public.camera_recordings(company_id, driver_id, captured_at desc);
alter table public.camera_recordings enable row level security;
revoke all on public.camera_recordings from public, anon, authenticated;
grant all on public.camera_recordings to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-recordings', 'vehicle-recordings', false, 12582912, array['video/webm','video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.native_push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  updated_at timestamptz not null default now()
);
alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from public, anon, authenticated;
grant all on public.native_push_tokens to service_role;
