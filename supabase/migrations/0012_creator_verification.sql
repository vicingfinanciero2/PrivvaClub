-- =====================================================================================
--  PrivvaClub — Migración 0012: Verificación de creador (KYC) "Become a Creator"
--
--  Aparece solo cuando el ofertante quiere monetizar. Datos SENSIBLES (documento, selfie,
--  datos bancarios): bucket PRIVADO + RLS estricta. El estado de la solicitud solo cambia
--  vía RPC/admin (un trigger impide que el dueño se auto-apruebe).
--
--  Flujo de estados: draft -> submitted -> in_review -> approved | rejected
-- =====================================================================================

-- §1 — Enum de estado de la solicitud.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'creator_app_status') then
    create type public.creator_app_status as enum
      ('draft', 'submitted', 'in_review', 'approved', 'rejected');
  end if;
end$$;

-- §2 — Tabla de solicitudes (1:1 con el perfil).
create table if not exists public.creator_applications (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null unique references public.profiles (id) on delete cascade,
  status                 public.creator_app_status not null default 'draft',

  -- Paso 1: información personal
  full_name              text,
  birth_date             date,
  doc_type               text,            -- cc | ce | passport
  doc_number             text,

  -- Paso 2 y 3: documento + selfies (paths en bucket privado, NO urls públicas)
  doc_front_path         text,
  doc_back_path          text,
  selfie_path            text,
  selfie_with_doc_path   text,

  -- Paso 4: datos bancarios (en producción, tokenizar con la pasarela)
  bank_name              text,
  bank_account_type      text,            -- ahorros | corriente
  bank_account_number    text,

  -- Paso 5: redes sociales
  social_instagram       text,
  social_tiktok          text,
  social_x               text,

  -- Auditoría / revisión
  submitted_at           timestamptz,
  reviewed_at            timestamptz,
  reviewed_by            uuid references public.profiles (id),
  rejection_reason       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.creator_applications is 'Solicitudes KYC para monetizar (Become a Creator). Datos sensibles.';

create index if not exists idx_creator_app_status on public.creator_applications (status);

-- updated_at
drop trigger if exists set_updated_at on public.creator_applications;
create trigger set_updated_at before update on public.creator_applications
  for each row execute function public.tg_set_updated_at();

-- §3 — Guard: el dueño edita datos pero NO el estado (anti auto-aprobación).
create or replace function public.tg_guard_creator_app()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'INSERT' then
      new.status := 'draft';                 -- nace siempre como borrador
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'El estado de la solicitud no puede cambiarse directamente.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_creator_app on public.creator_applications;
create trigger guard_creator_app
  before insert or update on public.creator_applications
  for each row execute function public.tg_guard_creator_app();

-- §4 — RLS.
alter table public.creator_applications enable row level security;

drop policy if exists creatorapp_select_own_or_admin on public.creator_applications;
create policy creatorapp_select_own_or_admin on public.creator_applications
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists creatorapp_insert_own on public.creator_applications;
create policy creatorapp_insert_own on public.creator_applications
  for insert to authenticated with check (profile_id = (select auth.uid()));

drop policy if exists creatorapp_update_own on public.creator_applications;
create policy creatorapp_update_own on public.creator_applications
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- §5 — RPC de envío: valida campos mínimos y pasa a 'submitted'.
create or replace function public.fn_submit_creator_application()
returns public.creator_app_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     public.creator_applications;
begin
  if v_uid is null then
    raise exception 'Se requiere autenticación' using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.creator_applications where profile_id = v_uid;
  if not found then
    raise exception 'No existe una solicitud para enviar' using errcode = 'no_data_found';
  end if;
  if r.status not in ('draft', 'rejected') then
    return r.status;  -- ya enviada / en revisión / aprobada
  end if;

  -- Validación de completitud mínima.
  if r.full_name is null or r.doc_type is null or r.doc_number is null
     or r.doc_front_path is null or r.selfie_path is null
     or r.bank_account_number is null then
    raise exception 'Faltan campos obligatorios para enviar la verificación.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.creator_applications
    set status = 'submitted', submitted_at = now(), rejection_reason = null
    where profile_id = v_uid;

  return 'submitted';
end;
$$;

revoke execute on function public.fn_submit_creator_application() from public, anon;
grant execute on function public.fn_submit_creator_application() to authenticated;

-- §6 — Bucket PRIVADO para KYC + políticas (solo dueño en su carpeta; admin puede leer).
insert into storage.buckets (id, name, public)
values ('creator-kyc', 'creator-kyc', false)
on conflict (id) do update set public = false;

drop policy if exists "kyc_insert_own_folder" on storage.objects;
create policy "kyc_insert_own_folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'creator-kyc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "kyc_select_own_or_admin" on storage.objects;
create policy "kyc_select_own_or_admin" on storage.objects
  for select to authenticated using (
    bucket_id = 'creator-kyc'
    and (owner = (select auth.uid()) or (select public.is_admin()))
  );

drop policy if exists "kyc_update_own" on storage.objects;
create policy "kyc_update_own" on storage.objects
  for update to authenticated using (bucket_id = 'creator-kyc' and owner = (select auth.uid()));

drop policy if exists "kyc_delete_own" on storage.objects;
create policy "kyc_delete_own" on storage.objects
  for delete to authenticated using (bucket_id = 'creator-kyc' and owner = (select auth.uid()));

-- =====================================================================================
--  FIN 0012
--  Siguiente fase (no incluida): RPC fn_review_creator_application para el admin
--  (approve/reject -> activa account_status) y el reconocimiento facial automático
--  vía Edge Function + proveedor KYC.
-- =====================================================================================
