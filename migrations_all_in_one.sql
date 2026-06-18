-- #####################################################################################
-- #  PrivvaClub — SCRIPT CONSOLIDADO (esquema + seguridad + lógica + datos)            #
-- #                                                                                    #
-- #  Un solo viaje al SQL Editor de Supabase: pega TODO y dale Run.                     #
-- #  Orden: 0001 -> 0002 -> 0003 -> 0004 -> SEED.                                       #
-- #                                                                                    #
-- #  BLINDAJE PARA CLOUD: los puntos que pueden fallar por permisos/extensiones en un  #
-- #  proyecto gestionado van envueltos en bloques DO ... EXCEPTION para que NO aborten  #
-- #  el script completo (solo emiten un NOTICE). Concretamente:                         #
-- #    - Extensión pg_cron y su agendado (§0 / §10 de 0001).                            #
-- #    - Políticas sobre realtime.messages (§9 de 0001).                                #
-- #    - (extra) ENABLE RLS sobre storage.* (0002), por la misma clase de ownership.    #
-- #  Si alguno se omite, el resto del esquema queda creado igual; esos detalles se      #
-- #  configuran luego desde el dashboard.                                               #
-- #####################################################################################


-- #####################################################################################
-- #  MIGRACIÓN 0001 — ESQUEMA + RLS + CHAT ANÓNIMO + CRÉDITOS                           #
-- #####################################################################################

-- =====================================================================================
-- §0 — EXTENSIONES
-- =====================================================================================
create extension if not exists pgcrypto;          -- gen_random_uuid()

-- pg_cron puede requerir habilitación previa en el dashboard; lo intentamos sin abortar.
do $cron_ext$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron no se pudo habilitar (%). Actívalo en Database -> Extensions y reagenda la purga.', sqlerrm;
end
$cron_ext$;


-- =====================================================================================
-- §1 — TIPOS ENUM
-- =====================================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_status_t') then
    create type public.account_status_t as enum ('pending_review', 'active', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'ad_status_t') then
    create type public.ad_status_t as enum ('draft', 'active', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_type_t') then
    create type public.transaction_type_t as enum ('deposit', 'ad_publish', 'ad_bump');
  end if;
  if not exists (select 1 from pg_type where typname = 'sender_type_t') then
    create type public.sender_type_t as enum ('advertiser', 'client');
  end if;
end$$;


-- =====================================================================================
-- §2 — TABLAS
-- =====================================================================================
create table if not exists public.cities (
  id          smallint    generated always as identity primary key,
  name        text        not null unique,
  slug        text        not null unique,
  is_active   boolean     not null default true,
  sort_order  smallint    not null default 0
);
comment on table public.cities is 'Catálogo de ciudades habilitadas para publicar anuncios.';

insert into public.cities (name, slug, sort_order) values
  ('Bogotá',       'bogota',       1),
  ('Medellín',     'medellin',     2),
  ('Cali',         'cali',         3),
  ('Barranquilla', 'barranquilla', 4),
  ('Bucaramanga',  'bucaramanga',  5),
  ('Cartagena',    'cartagena',    6),
  ('Pereira',      'pereira',      7)
on conflict (slug) do nothing;

create table if not exists public.profiles (
  id              uuid                    primary key references auth.users (id) on delete cascade,
  username        text                    unique,
  credit_balance  integer                 not null default 0 check (credit_balance >= 0),
  account_status  public.account_status_t not null default 'pending_review',
  created_at      timestamptz             not null default now(),
  updated_at      timestamptz             not null default now()
);
comment on table public.profiles is 'Perfil público del anunciante; extensión 1:1 de auth.users.';
comment on column public.profiles.credit_balance is 'Saldo de créditos. CHECK >= 0; solo se modifica vía RPC SECURITY DEFINER.';

create table if not exists public.ads (
  id                uuid               primary key default gen_random_uuid(),
  profile_id        uuid               not null references public.profiles (id) on delete cascade,
  title             text               not null check (length(title) between 1 and 160),
  description       text               check (length(description) <= 4000),
  price             numeric(12,2)      check (price >= 0),
  city_id           smallint           not null references public.cities (id),
  zone_neighborhood text,
  age               integer            check (age >= 18),
  image_urls        text[]             not null default '{}',
  status            public.ad_status_t not null default 'draft',
  bumped_at         timestamptz        not null default now(),
  created_at        timestamptz        not null default now()
);
comment on table public.ads is 'Anuncios publicados por los anunciantes.';
comment on column public.ads.bumped_at is 'Marca de posicionamiento; el feed ordena por bumped_at DESC.';
comment on column public.ads.age is 'Edad declarada; CHECK >= 18 por requisito legal.';

create table if not exists public.ads_verification (
  ad_id                  uuid        primary key references public.ads (id) on delete cascade,
  is_verified_by_studio  boolean     not null default false,
  verified_at            timestamptz,
  verified_by            uuid        references public.profiles (id)
);
comment on table public.ads_verification is 'Verificación oficial (fotos del fotógrafo de la plataforma). Solo administradores escriben aquí.';

create table if not exists public.credit_transactions (
  id                uuid                    primary key default gen_random_uuid(),
  profile_id        uuid                    not null references public.profiles (id) on delete cascade,
  amount            integer                 not null,
  transaction_type  public.transaction_type_t not null,
  ad_id             uuid                    references public.ads (id) on delete set null,
  created_at        timestamptz             not null default now()
);
comment on table public.credit_transactions is 'Auditoría de créditos. Solo se inserta desde RPCs SECURITY DEFINER.';

create table if not exists public.chat_rooms (
  id                 uuid        primary key default gen_random_uuid(),
  ad_id              uuid        not null references public.ads (id) on delete cascade,
  advertiser_id      uuid        not null references public.profiles (id) on delete cascade,
  client_session_id  text        not null,
  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chat_rooms_ad_session_uk unique (ad_id, client_session_id)
);
comment on table public.chat_rooms is 'Sala de chat efímera. client_session_id = UUID aleatorio del cliente (bearer token).';

create table if not exists public.chat_messages (
  id            bigint generated always as identity primary key,
  room_id       uuid                 not null references public.chat_rooms (id) on delete cascade,
  sender_type   public.sender_type_t not null,
  message_text  text                 not null check (length(message_text) between 1 and 4000),
  is_read       boolean              not null default false,
  created_at    timestamptz          not null default now()
);
comment on table public.chat_messages is 'Mensajes del chat. Texto sanitizado en el frontend; longitud acotada en DB.';


-- =====================================================================================
-- §3 — ÍNDICES
-- =====================================================================================
create index if not exists idx_ads_city_bumped_active
  on public.ads (city_id, bumped_at desc) where status = 'active';
create index if not exists idx_ads_bumped_active
  on public.ads (bumped_at desc) where status = 'active';
create index if not exists idx_ads_profile on public.ads (profile_id);
create index if not exists idx_chat_messages_room_created
  on public.chat_messages (room_id, created_at desc);
create index if not exists idx_chat_messages_unread
  on public.chat_messages (room_id) where is_read = false;
create index if not exists idx_credit_tx_profile_created
  on public.credit_transactions (profile_id, created_at desc);
create index if not exists idx_chat_rooms_advertiser on public.chat_rooms (advertiser_id);
create index if not exists idx_chat_rooms_purge on public.chat_rooms (updated_at, is_active);


-- =====================================================================================
-- §4 — FUNCIONES AUXILIARES
-- =====================================================================================
create or replace function public.is_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
comment on function public.is_admin() is 'TRUE si el JWT trae app_metadata.role = admin.';

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =====================================================================================
-- §5 — TRIGGERS
-- =====================================================================================
drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.chat_rooms;
create trigger set_updated_at before update on public.chat_rooms
  for each row execute function public.tg_set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, account_status)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'user_' || left(replace(new.id::text, '-', ''), 12)
    ),
    'pending_review'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function public.handle_new_user() is 'Crea el profiles correspondiente tras INSERT en auth.users.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.tg_guard_credit_balance()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.credit_balance is distinct from old.credit_balance
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
  then
    raise exception 'El saldo de créditos no puede modificarse directamente; use las funciones de la plataforma.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_credit_balance on public.profiles;
create trigger guard_credit_balance before update on public.profiles
  for each row execute function public.tg_guard_credit_balance();


-- =====================================================================================
-- §6 — RLS + POLÍTICAS
-- =====================================================================================
alter table public.cities              enable row level security;
alter table public.profiles            enable row level security;
alter table public.ads                 enable row level security;
alter table public.ads_verification    enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.chat_rooms          enable row level security;
alter table public.chat_messages       enable row level security;

drop policy if exists cities_select_public on public.cities;
create policy cities_select_public on public.cities
  for select to anon, authenticated using (true);
drop policy if exists cities_admin_write on public.cities;
create policy cities_admin_write on public.cities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists ads_select_active_public on public.ads;
create policy ads_select_active_public on public.ads
  for select to anon, authenticated using (status = 'active');
drop policy if exists ads_select_own on public.ads;
create policy ads_select_own on public.ads
  for select to authenticated using (profile_id = auth.uid());
drop policy if exists ads_insert_own on public.ads;
create policy ads_insert_own on public.ads
  for insert to authenticated with check (profile_id = auth.uid());
drop policy if exists ads_update_own on public.ads;
create policy ads_update_own on public.ads
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists ads_delete_own on public.ads;
create policy ads_delete_own on public.ads
  for delete to authenticated using (profile_id = auth.uid());

drop policy if exists adsverif_select_public on public.ads_verification;
create policy adsverif_select_public on public.ads_verification
  for select to anon, authenticated using (true);
drop policy if exists adsverif_admin_write on public.ads_verification;
create policy adsverif_admin_write on public.ads_verification
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists credittx_select_own on public.credit_transactions;
create policy credittx_select_own on public.credit_transactions
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());

drop policy if exists chatrooms_advertiser_select on public.chat_rooms;
create policy chatrooms_advertiser_select on public.chat_rooms
  for select to authenticated using (advertiser_id = auth.uid());
drop policy if exists chatrooms_advertiser_update on public.chat_rooms;
create policy chatrooms_advertiser_update on public.chat_rooms
  for update to authenticated using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());

drop policy if exists chatmsg_advertiser_select on public.chat_messages;
create policy chatmsg_advertiser_select on public.chat_messages
  for select to authenticated using (
    exists (select 1 from public.chat_rooms r
            where r.id = chat_messages.room_id and r.advertiser_id = auth.uid())
  );
drop policy if exists chatmsg_advertiser_insert on public.chat_messages;
create policy chatmsg_advertiser_insert on public.chat_messages
  for insert to authenticated with check (
    sender_type = 'advertiser'
    and exists (select 1 from public.chat_rooms r
                where r.id = chat_messages.room_id and r.advertiser_id = auth.uid())
  );
drop policy if exists chatmsg_advertiser_update on public.chat_messages;
create policy chatmsg_advertiser_update on public.chat_messages
  for update to authenticated using (
    exists (select 1 from public.chat_rooms r
            where r.id = chat_messages.room_id and r.advertiser_id = auth.uid())
  );


-- =====================================================================================
-- §7 — RPCs DEL CHAT ANÓNIMO (SECURITY DEFINER)
-- =====================================================================================
create or replace function public.fn_get_or_create_chat_room(
  p_ad_id uuid, p_session_id text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_advertiser uuid;
  v_room_id    uuid;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    raise exception 'session_id inválido' using errcode = 'invalid_parameter_value';
  end if;

  select a.profile_id into v_advertiser
  from public.ads a where a.id = p_ad_id and a.status = 'active';

  if v_advertiser is null then
    raise exception 'El anuncio no existe o no está activo' using errcode = 'no_data_found';
  end if;

  insert into public.chat_rooms (ad_id, advertiser_id, client_session_id)
  values (p_ad_id, v_advertiser, p_session_id)
  on conflict (ad_id, client_session_id)
    do update set is_active = true, updated_at = now()
  returning id into v_room_id;

  return v_room_id;
end;
$$;

create or replace function public.fn_send_client_message(
  p_room_id uuid, p_session_id text, p_text text
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_msg_id bigint;
begin
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'El mensaje no puede estar vacío' using errcode = 'invalid_parameter_value';
  end if;
  if length(p_text) > 4000 then
    raise exception 'El mensaje excede la longitud máxima' using errcode = 'string_data_right_truncation';
  end if;

  if not exists (
    select 1 from public.chat_rooms r
    where r.id = p_room_id and r.client_session_id = p_session_id and r.is_active
  ) then
    raise exception 'Sesión no autorizada para esta sala' using errcode = 'insufficient_privilege';
  end if;

  insert into public.chat_messages (room_id, sender_type, message_text)
  values (p_room_id, 'client', p_text)
  returning id into v_msg_id;

  update public.chat_rooms set updated_at = now() where id = p_room_id;
  return v_msg_id;
end;
$$;

create or replace function public.fn_get_messages(
  p_room_id uuid, p_session_id text
)
returns setof public.chat_messages language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_rooms r
    where r.id = p_room_id and r.client_session_id = p_session_id
  ) then
    raise exception 'Sesión no autorizada para esta sala' using errcode = 'insufficient_privilege';
  end if;

  return query
    select * from public.chat_messages m
    where m.room_id = p_room_id order by m.created_at asc;
end;
$$;

create or replace function public.fn_mark_read_by_client(
  p_room_id uuid, p_session_id text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_rooms r
    where r.id = p_room_id and r.client_session_id = p_session_id
  ) then
    raise exception 'Sesión no autorizada para esta sala' using errcode = 'insufficient_privilege';
  end if;

  update public.chat_messages set is_read = true
  where room_id = p_room_id and sender_type = 'advertiser' and is_read = false;
end;
$$;


-- =====================================================================================
-- §8 — RPCs DE MONETIZACIÓN
-- =====================================================================================
create or replace function public.fn_bump_ad(target_ad_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
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

  select credit_balance into v_balance from public.profiles where id = v_uid for update;

  if v_balance < c_bump_cost then
    raise exception 'Saldo insuficiente: el bump cuesta % créditos y dispones de %.',
      c_bump_cost, v_balance using errcode = 'insufficient_resources';
  end if;

  update public.profiles set credit_balance = credit_balance - c_bump_cost where id = v_uid;

  insert into public.credit_transactions (profile_id, amount, transaction_type, ad_id)
  values (v_uid, -c_bump_cost, 'ad_bump', target_ad_id);

  update public.ads set bumped_at = now() where id = target_ad_id returning bumped_at into v_bumped_at;
  return v_bumped_at;
end;
$$;
comment on function public.fn_bump_ad(uuid) is 'Cobra 5 créditos y empuja el anuncio al inicio del feed (bumped_at = now()).';

create or replace function public.fn_publish_ad(target_ad_id uuid)
returns public.ad_status_t language plpgsql security definer set search_path = ''
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
    return v_status;
  end if;

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
comment on function public.fn_publish_ad(uuid) is 'Cobra 10 créditos y pasa el anuncio a status = active.';


-- =====================================================================================
-- §9 — REALTIME BROADCAST
--   El trigger/función viven en public (siempre se crean). La autorización sobre
--   realtime.messages va envuelta: si postgres no es dueño de esa tabla en este
--   proyecto, se omite con un NOTICE sin abortar el script.
-- =====================================================================================
create or replace function public.tg_broadcast_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id',           new.id,
      'room_id',      new.room_id,
      'sender_type',  new.sender_type,
      'message_text', new.message_text,
      'created_at',   new.created_at
    ),
    'new_message',
    'room:' || new.room_id::text,
    true
  );
  return new;
end;
$$;

drop trigger if exists broadcast_message on public.chat_messages;
create trigger broadcast_message after insert on public.chat_messages
  for each row execute function public.tg_broadcast_message();

do $rt$
begin
  alter table realtime.messages enable row level security;

  drop policy if exists rt_room_advertiser on realtime.messages;
  create policy rt_room_advertiser on realtime.messages
    for select to authenticated using (
      realtime.messages.extension = 'broadcast'
      and exists (
        select 1 from public.chat_rooms r
        where 'room:' || r.id::text = realtime.topic()
          and r.advertiser_id = auth.uid()
      )
    );

  drop policy if exists rt_room_anon on realtime.messages;
  create policy rt_room_anon on realtime.messages
    for select to anon using (
      realtime.messages.extension = 'broadcast'
      and exists (
        select 1 from public.chat_rooms r
        where 'room:' || r.id::text = realtime.topic()
          and r.is_active
      )
    );
exception
  when insufficient_privilege then
    raise notice 'Sin privilegios sobre realtime.messages (%). Configura la autorización de Broadcast desde Realtime -> Policies en el dashboard.', sqlerrm;
  when others then
    raise notice 'No se pudieron aplicar las políticas de realtime.messages (%).', sqlerrm;
end
$rt$;


-- =====================================================================================
-- §10 — AUTOLIMPIEZA DE CHATS FANTASMA
-- =====================================================================================
create or replace function public.fn_purge_old_anonymous_chats()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_deleted_rooms integer;
begin
  with purged as (
    delete from public.chat_rooms r
    where (r.is_active = false and r.updated_at < now() - interval '48 hours')
       or (r.updated_at < now() - interval '48 hours')
    returning 1
  )
  select count(*) into v_deleted_rooms from purged;

  raise notice 'fn_purge_old_anonymous_chats: % salas eliminadas', v_deleted_rooms;
  return v_deleted_rooms;
end;
$$;
comment on function public.fn_purge_old_anonymous_chats() is 'Borra salas/mensajes anónimos con >48h de inactividad. Agendada con pg_cron.';

-- Agendado con pg_cron, envuelto: si pg_cron no está disponible, no aborta.
do $cron_sched$
begin
  if exists (select 1 from cron.job where jobname = 'purge-anon-chats') then
    perform cron.unschedule('purge-anon-chats');
  end if;
  perform cron.schedule(
    'purge-anon-chats',
    '0 * * * *',
    $cron$ select public.fn_purge_old_anonymous_chats(); $cron$
  );
exception when others then
  raise notice 'No se pudo agendar la purga con pg_cron (%). Agéndala manualmente cuando habilites la extensión.', sqlerrm;
end
$cron_sched$;


-- =====================================================================================
-- §11 — GRANTS
-- =====================================================================================
grant select on public.cities           to anon, authenticated;
grant select on public.ads              to anon, authenticated;
grant select on public.ads_verification to anon, authenticated;

grant select, insert, update, delete on public.ads      to authenticated;
grant select, update                 on public.profiles  to authenticated;
grant select                         on public.credit_transactions to authenticated;
grant select, update                 on public.chat_rooms    to authenticated;
grant select, insert, update         on public.chat_messages to authenticated;

revoke all on public.chat_rooms    from anon;
revoke all on public.chat_messages from anon;

grant execute on function public.fn_get_or_create_chat_room(uuid, text)   to anon, authenticated;
grant execute on function public.fn_send_client_message(uuid, text, text) to anon, authenticated;
grant execute on function public.fn_get_messages(uuid, text)              to anon, authenticated;
grant execute on function public.fn_mark_read_by_client(uuid, text)       to anon, authenticated;
grant execute on function public.fn_bump_ad(uuid)    to authenticated;
grant execute on function public.fn_publish_ad(uuid) to authenticated;


-- #####################################################################################
-- #  MIGRACIÓN 0002 — STORAGE (bucket ad-images + políticas)                           #
-- #####################################################################################
insert into storage.buckets (id, name, public)
values ('ad-images', 'ad-images', true)
on conflict (id) do update set public = excluded.public;

-- ENABLE RLS sobre storage.* puede fallar por ownership en cloud -> envuelto.
do $st$
begin
  alter table storage.objects enable row level security;
  alter table storage.buckets enable row level security;
exception when others then
  raise notice 'No se pudo (re)activar RLS en storage (%); normalmente ya viene activo en Supabase.', sqlerrm;
end
$st$;

drop policy if exists "ad_images_bucket_public_read" on storage.buckets;
create policy "ad_images_bucket_public_read" on storage.buckets
  for select to anon, authenticated using (id = 'ad-images');

drop policy if exists "ad_images_public_read" on storage.objects;
create policy "ad_images_public_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'ad-images');

drop policy if exists "ad_images_insert_own_folder" on storage.objects;
create policy "ad_images_insert_own_folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'ad-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ad_images_update_own" on storage.objects;
create policy "ad_images_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'ad-images' and owner = auth.uid())
  with check (
    bucket_id = 'ad-images' and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ad_images_delete_own" on storage.objects;
create policy "ad_images_delete_own" on storage.objects
  for delete to authenticated using (bucket_id = 'ad-images' and owner = auth.uid());


-- #####################################################################################
-- #  MIGRACIÓN 0003 — MOTOR DE RECARGAS (idempotente)                                  #
-- #####################################################################################
alter table public.credit_transactions add column if not exists external_ref text;
comment on column public.credit_transactions.external_ref is
  'Id de transacción de la pasarela de pagos (idempotencia). Único cuando no es nulo.';

create unique index if not exists uq_credit_tx_external_ref
  on public.credit_transactions (external_ref) where external_ref is not null;

create or replace function public.fn_deposit_credits_by_admin(
  p_profile_id uuid, p_amount integer, p_transaction_id text
)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a acreditar debe ser positivo (recibido: %).', p_amount
      using errcode = 'invalid_parameter_value';
  end if;
  if p_transaction_id is null or length(btrim(p_transaction_id)) = 0 then
    raise exception 'Se requiere el id de transacción de la pasarela (idempotencia).'
      using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'El perfil destino no existe (%).', p_profile_id using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.credit_transactions where external_ref = p_transaction_id) then
    select credit_balance into v_new_balance from public.profiles where id = p_profile_id;
    raise notice 'Transacción % ya procesada; no se acredita de nuevo.', p_transaction_id;
    return v_new_balance;
  end if;

  update public.profiles set credit_balance = credit_balance + p_amount
    where id = p_profile_id returning credit_balance into v_new_balance;

  insert into public.credit_transactions (profile_id, amount, transaction_type, external_ref)
  values (p_profile_id, p_amount, 'deposit', p_transaction_id);

  return v_new_balance;
end;
$$;
comment on function public.fn_deposit_credits_by_admin(uuid, integer, text) is
  'Acredita créditos (deposit) de forma transaccional e idempotente. Solo service_role.';

revoke execute on function public.fn_deposit_credits_by_admin(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.fn_deposit_credits_by_admin(uuid, integer, text)
  to service_role;


-- #####################################################################################
-- #  MIGRACIÓN 0004 — VERIFICACIÓN POR ADMIN                                           #
-- #####################################################################################
create or replace function public.fn_verify_ad_by_admin(
  p_ad_id uuid, p_is_verified boolean
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_admin  uuid := auth.uid();
  v_result boolean;
begin
  if not public.is_admin() then
    raise exception 'Acceso denegado: se requiere rol de administrador.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.ads where id = p_ad_id) then
    raise exception 'El anuncio no existe (%).', p_ad_id using errcode = 'no_data_found';
  end if;

  if p_is_verified then
    insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
    values (p_ad_id, true, now(), v_admin)
    on conflict (ad_id) do update
      set is_verified_by_studio = true, verified_at = now(), verified_by = v_admin;
  else
    insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
    values (p_ad_id, false, null, v_admin)
    on conflict (ad_id) do update
      set is_verified_by_studio = false, verified_at = null, verified_by = v_admin;
  end if;

  select is_verified_by_studio into v_result from public.ads_verification where ad_id = p_ad_id;
  return v_result;
end;
$$;
comment on function public.fn_verify_ad_by_admin(uuid, boolean) is
  'Activa/retira el sello de verificación de un anuncio. Solo administradores (is_admin()).';

revoke execute on function public.fn_verify_ad_by_admin(uuid, boolean) from public, anon;
grant execute on function public.fn_verify_ad_by_admin(uuid, boolean) to authenticated;


-- #####################################################################################
-- #  SEED — DATOS DE PRUEBA (cloud)                                                    #
-- #  Idempotente: borra los usuarios semilla por UUID fijo; el CASCADE arrastra todo.  #
-- #  Login demo: <email> / Password123!                                                #
-- #####################################################################################
delete from auth.users where id in (
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000',
   'b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'sofia@privva.demo', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"sofia_b"}'::jsonb, '', '', '', ''),

  ('00000000-0000-0000-0000-000000000000',
   'b1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'camila@privva.demo', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"camila_m"}'::jsonb, '', '', '', '');

update public.profiles set account_status = 'active', credit_balance = 200 where id = 'b1000000-0000-0000-0000-000000000001';
update public.profiles set account_status = 'active', credit_balance = 350 where id = 'b1000000-0000-0000-0000-000000000002';

insert into public.ads (
  id, profile_id, title, description, price, city_id, zone_neighborhood, age,
  image_urls, status, bumped_at, created_at
)
values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Sofía — Acompañamiento exclusivo', 'Trato elegante y discreto. Disponibilidad nocturna en zona norte.',
   350000, (select id from public.cities where slug = 'bogota'), 'Chapinero', 24,
   array[
     'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80',
     'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80'
   ],
   'active', now() - interval '2 minutes', now() - interval '2 days'),

  ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',
   'Camila — Experiencia premium', 'Atención personalizada, ambiente privado y cómodo.',
   400000, (select id from public.cities where slug = 'bogota'), 'Usaquén', 26,
   array['https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80'],
   'active', now() - interval '40 minutes', now() - interval '1 day'),

  ('c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001',
   'Sofía — Disponible en El Poblado', 'Encuentros exclusivos, máxima discreción.',
   300000, (select id from public.cities where slug = 'medellin'), 'El Poblado', 24,
   array['https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=80'],
   'active', now() - interval '15 minutes', now() - interval '3 days'),

  ('c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000002',
   'Camila — Atención inmediata', 'Zona Laureles, ambiente relajado y privado.',
   250000, (select id from public.cities where slug = 'medellin'), 'Laureles', 27,
   array['https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80'],
   'active', now() - interval '3 hours', now() - interval '12 hours');

insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
values
  ('c1000000-0000-0000-0000-000000000001', true, now() - interval '1 day', null),
  ('c1000000-0000-0000-0000-000000000003', true, now() - interval '2 days', null)
on conflict (ad_id) do update
  set is_verified_by_studio = excluded.is_verified_by_studio,
      verified_at = excluded.verified_at;

-- #####################################################################################
-- #  FIN — esquema + seguridad + lógica + datos en un solo Run.                        #
-- #  Resultado: 7 ciudades, 2 anunciantes (200/350 créditos), 4 anuncios activos       #
-- #  (2 Bogotá, 2 Medellín; 2 verificados).                                            #
-- #####################################################################################
