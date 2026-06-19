-- =====================================================================================
--  PrivvaClub — Migración 0011: Campos de perfil + blindaje de columnas sensibles
--
--  UX: reducir fricción tras el registro. El ofertante puede personalizar su perfil
--  (foto + biografía) sin verificar identidad todavía.
--
--  SEGURIDAD: la política profiles_update_own permite al dueño actualizar su fila, lo
--  que incluía columnas que NO debe poder cambiar a mano:
--    - credit_balance        (ya estaba protegido por trigger)
--    - subscription_expires_at  (¡daría premium gratis!)
--    - account_status           (¡auto-activación / saltarse moderación!)
--  Se reemplaza el guard por uno que protege las tres. El dueño solo puede editar
--  campos "cosméticos" (username, avatar_url, bio, billing_model).
-- =====================================================================================

-- §1 — Campos de perfil personalizables.
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_len'
  ) then
    alter table public.profiles
      add constraint profiles_bio_len check (bio is null or length(bio) <= 500);
  end if;
end$$;

comment on column public.profiles.avatar_url is 'URL pública de la foto de perfil (bucket ad-images/<uid>/avatar/...).';
comment on column public.profiles.bio is 'Biografía corta del anunciante (máx. 500).';


-- §2 — Guard ampliado: bloquea cambios directos a columnas sensibles desde la API.
--   Dentro de las RPCs SECURITY DEFINER current_user es el owner -> pasan el check.
create or replace function public.tg_guard_profile_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    if new.credit_balance is distinct from old.credit_balance then
      raise exception 'El saldo de créditos no puede modificarse directamente.'
        using errcode = 'check_violation';
    end if;
    if new.subscription_expires_at is distinct from old.subscription_expires_at then
      raise exception 'La suscripción no puede modificarse directamente.'
        using errcode = 'check_violation';
    end if;
    if new.account_status is distinct from old.account_status then
      raise exception 'El estado de cuenta no puede modificarse directamente.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Reemplaza el trigger anterior (que solo cuidaba el saldo).
drop trigger if exists guard_credit_balance on public.profiles;
drop trigger if exists guard_profile_fields on public.profiles;
create trigger guard_profile_fields
  before update on public.profiles
  for each row execute function public.tg_guard_profile_fields();

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0011
-- =====================================================================================
