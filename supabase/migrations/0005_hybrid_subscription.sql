-- =====================================================================================
--  PrivvaClub — Migración 0005: Modelo HÍBRIDO de monetización (créditos + suscripción)
--
--  El ofertante elige cómo trabajar:
--    A) Por uso (créditos): paga ad_publish / ad_bump (flujo de 0001/0003).
--    B) Suscripción premium: membresía con vigencia; mientras esté activa, publicar y
--       hacer bump NO consume créditos.
--
--  Cambios:
--    §1 — Campos de suscripción en profiles + enum billing_model_t.
--    §2 — Helper has_active_subscription().
--    §3 — fn_publish_ad / fn_bump_ad ahora exoneran el cobro si hay suscripción activa.
--    §4 — Tabla de eventos + RPC fn_activate_subscription_by_admin() (idempotente,
--         para el webhook de pagos / service_role).
--
--  Depende de 0001 y 0003.
-- =====================================================================================


-- =====================================================================================
-- §1 — CAMPOS DE SUSCRIPCIÓN
-- =====================================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_model_t') then
    create type public.billing_model_t as enum ('credits', 'subscription');
  end if;
end$$;

alter table public.profiles
  add column if not exists billing_model public.billing_model_t not null default 'credits';

alter table public.profiles
  add column if not exists subscription_expires_at timestamptz;

comment on column public.profiles.billing_model is 'Preferencia de facturación del anunciante: credits | subscription.';
comment on column public.profiles.subscription_expires_at is 'Vigencia de la membresía premium; NULL o pasado = sin suscripción activa.';


-- =====================================================================================
-- §2 — HELPER: ¿suscripción activa?
-- =====================================================================================
create or replace function public.has_active_subscription(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_profile_id
      and subscription_expires_at is not null
      and subscription_expires_at > now()
  );
$$;

comment on function public.has_active_subscription(uuid) is 'TRUE si el perfil tiene membresía premium vigente.';


-- =====================================================================================
-- §3 — RPCs DE MONETIZACIÓN CON EXONERACIÓN POR SUSCRIPCIÓN
--   Si hay suscripción activa, se ejecuta la acción sin cobrar créditos.
-- =====================================================================================

-- fn_bump_ad: bump gratis para premium; cobro de 5 créditos para el modelo por uso.
create or replace function public.fn_bump_ad(target_ad_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_bump_cost constant integer := 5;
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_balance   integer;
  v_bumped_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Se requiere autenticación' using errcode = 'insufficient_privilege';
  end if;

  select profile_id into v_owner from public.ads where id = target_ad_id;
  if v_owner is null then
    raise exception 'El anuncio no existe' using errcode = 'no_data_found';
  end if;
  if v_owner <> v_uid then
    raise exception 'No eres el dueño de este anuncio' using errcode = 'insufficient_privilege';
  end if;

  -- Premium: bump sin costo.
  if public.has_active_subscription(v_uid) then
    update public.ads set bumped_at = now()
      where id = target_ad_id returning bumped_at into v_bumped_at;
    return v_bumped_at;
  end if;

  -- Modelo por uso: cobro transaccional con bloqueo de fila.
  select credit_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < c_bump_cost then
    raise exception 'Saldo insuficiente: el bump cuesta % créditos y dispones de %.',
      c_bump_cost, v_balance using errcode = 'insufficient_resources';
  end if;

  update public.profiles set credit_balance = credit_balance - c_bump_cost where id = v_uid;

  insert into public.credit_transactions (profile_id, amount, transaction_type, ad_id)
  values (v_uid, -c_bump_cost, 'ad_bump', target_ad_id);

  update public.ads set bumped_at = now()
    where id = target_ad_id returning bumped_at into v_bumped_at;
  return v_bumped_at;
end;
$$;
comment on function public.fn_bump_ad(uuid) is 'Bump del anuncio: gratis si hay suscripción activa, si no cobra 5 créditos.';


-- fn_publish_ad: publicación gratis para premium; 10 créditos para el modelo por uso.
create or replace function public.fn_publish_ad(target_ad_id uuid)
returns public.ad_status_t
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_publish_cost constant integer := 10;
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.ad_status_t;
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'Se requiere autenticación' using errcode = 'insufficient_privilege';
  end if;

  select profile_id, status into v_owner, v_status from public.ads where id = target_ad_id;
  if v_owner is null then
    raise exception 'El anuncio no existe' using errcode = 'no_data_found';
  end if;
  if v_owner <> v_uid then
    raise exception 'No eres el dueño de este anuncio' using errcode = 'insufficient_privilege';
  end if;
  if v_status = 'active' then
    return v_status;  -- ya publicado, no se cobra de nuevo
  end if;

  -- Premium: publicación sin costo.
  if public.has_active_subscription(v_uid) then
    update public.ads set status = 'active', bumped_at = now()
      where id = target_ad_id returning status into v_status;
    return v_status;
  end if;

  -- Modelo por uso: cobro transaccional con bloqueo de fila.
  select credit_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < c_publish_cost then
    raise exception 'Saldo insuficiente: publicar cuesta % créditos y dispones de %.',
      c_publish_cost, v_balance using errcode = 'insufficient_resources';
  end if;

  update public.profiles set credit_balance = credit_balance - c_publish_cost where id = v_uid;

  insert into public.credit_transactions (profile_id, amount, transaction_type, ad_id)
  values (v_uid, -c_publish_cost, 'ad_publish', target_ad_id);

  update public.ads set status = 'active', bumped_at = now()
    where id = target_ad_id returning status into v_status;
  return v_status;
end;
$$;
comment on function public.fn_publish_ad(uuid) is 'Publica el anuncio: gratis si hay suscripción activa, si no cobra 10 créditos.';


-- =====================================================================================
-- §4 — ACTIVACIÓN DE SUSCRIPCIÓN (idempotente, solo service_role)
--   El webhook de pagos llama esto cuando se cobra la membresía. Extiende la vigencia
--   desde la fecha mayor entre "ahora" y la expiración vigente (renovación acumulativa).
-- =====================================================================================
create table if not exists public.subscription_events (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles (id) on delete cascade,
  months        integer     not null check (months > 0),
  external_ref  text        not null unique,
  created_at    timestamptz not null default now()
);
comment on table public.subscription_events is 'Auditoría/idempotencia de activaciones de membresía premium.';

alter table public.subscription_events enable row level security;
drop policy if exists subevents_select_own on public.subscription_events;
create policy subevents_select_own on public.subscription_events
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());

create or replace function public.fn_activate_subscription_by_admin(
  p_profile_id     uuid,
  p_months         integer,
  p_transaction_id text
)
returns timestamptz                     -- nueva fecha de expiración
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base    timestamptz;
  v_new_exp timestamptz;
begin
  if p_months is null or p_months <= 0 then
    raise exception 'months debe ser positivo (recibido: %).', p_months
      using errcode = 'invalid_parameter_value';
  end if;
  if p_transaction_id is null or length(btrim(p_transaction_id)) = 0 then
    raise exception 'Se requiere el id de transacción (idempotencia).'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Bloqueo de fila para serializar webhooks concurrentes.
  select greatest(now(), coalesce(subscription_expires_at, now()))
    into v_base
  from public.profiles where id = p_profile_id for update;

  if not found then
    raise exception 'El perfil destino no existe (%).', p_profile_id using errcode = 'no_data_found';
  end if;

  -- Idempotencia: si ya se procesó esta transacción, devuelve la expiración actual.
  if exists (select 1 from public.subscription_events where external_ref = p_transaction_id) then
    select subscription_expires_at into v_new_exp from public.profiles where id = p_profile_id;
    raise notice 'Activación % ya procesada; sin cambios.', p_transaction_id;
    return v_new_exp;
  end if;

  v_new_exp := v_base + make_interval(months => p_months);

  update public.profiles
    set subscription_expires_at = v_new_exp,
        billing_model           = 'subscription'
    where id = p_profile_id;

  insert into public.subscription_events (profile_id, months, external_ref)
  values (p_profile_id, p_months, p_transaction_id);

  return v_new_exp;
end;
$$;
comment on function public.fn_activate_subscription_by_admin(uuid, integer, text) is
  'Extiende la membresía premium de forma idempotente. Solo service_role.';

revoke execute on function public.fn_activate_subscription_by_admin(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.fn_activate_subscription_by_admin(uuid, integer, text)
  to service_role;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0005
-- =====================================================================================
