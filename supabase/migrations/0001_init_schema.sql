-- =====================================================================================
--  PrivvaClub — Directorio premium de entretenimiento y acompañamiento (Colombia)
--  Migración inicial: esquema relacional + seguridad (RLS) + lógica de negocio.
--
--  Stack: Supabase (PostgreSQL 15+, Auth, Storage, Realtime).
--  Pegar este archivo completo en el editor SQL de Supabase y ejecutar.
--  Es modular por secciones (§0..§11) y, en lo posible, idempotente.
--
--  Modelo de negocio:
--    - Clientes (demandantes): acceso gratis, anónimo y sin registro (rol `anon`).
--    - Anunciantes (ofertantes): se registran (rol `authenticated`) y consumen
--      créditos internos para publicar / posicionar (bump) sus anuncios.
--    - No hay comisión por cita; la monetización es por visibilidad.
--
--  Seguridad (resumen):
--    - `anon` NO tiene acceso directo a ninguna tabla de datos sensibles.
--      Solo lee `ads` activos + catálogos públicos, y opera el chat vía RPC.
--    - El `client_session_id` (UUID en localStorage del cliente) actúa como
--      bearer token: quien lo conoce opera ESA sala y nada más.
--    - Funciones SECURITY DEFINER con `search_path = ''` (refs calificadas)
--      para evitar secuestro del search_path.
-- =====================================================================================


-- =====================================================================================
-- §0 — EXTENSIONES
-- =====================================================================================
create extension if not exists pgcrypto;          -- gen_random_uuid()
create extension if not exists pg_cron;            -- agendado de la purga de chats


-- =====================================================================================
-- §1 — TIPOS ENUM
--   (La ciudad NO es enum: se modela con la tabla catálogo `cities` en §2.)
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

-- ---------------------------------------------------------------------------
-- cities — catálogo de ciudades (escalable sin ALTER TYPE).
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- profiles — extiende auth.users (1:1). Solo anunciantes/administradores.
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- ads — anuncios.
-- ---------------------------------------------------------------------------
create table if not exists public.ads (
  id                uuid               primary key default gen_random_uuid(),
  profile_id        uuid               not null references public.profiles (id) on delete cascade,
  title             text               not null check (length(title) between 1 and 160),
  description       text               check (length(description) <= 4000),
  price             numeric(12,2)      check (price >= 0),
  city_id           smallint           not null references public.cities (id),
  zone_neighborhood text,
  age               integer            check (age >= 18),   -- cumplimiento legal del nicho
  image_urls        text[]             not null default '{}',
  status            public.ad_status_t not null default 'draft',
  bumped_at         timestamptz        not null default now(),
  created_at        timestamptz        not null default now()
);

comment on table public.ads is 'Anuncios publicados por los anunciantes.';
comment on column public.ads.bumped_at is 'Marca de posicionamiento; el feed ordena por bumped_at DESC.';
comment on column public.ads.age is 'Edad declarada; CHECK >= 18 por requisito legal.';


-- ---------------------------------------------------------------------------
-- ads_verification — sello de verificación por estudio (1:1 con ads).
--   El id es a la vez PK y FK a ads (relación uno a uno).
-- ---------------------------------------------------------------------------
create table if not exists public.ads_verification (
  ad_id                  uuid        primary key references public.ads (id) on delete cascade,
  is_verified_by_studio  boolean     not null default false,
  verified_at            timestamptz,
  verified_by            uuid        references public.profiles (id)
);

comment on table public.ads_verification is 'Verificación oficial (fotos del fotógrafo de la plataforma). Solo administradores escriben aquí.';


-- ---------------------------------------------------------------------------
-- credit_transactions — libro mayor inmutable de movimientos de créditos.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id                uuid                    primary key default gen_random_uuid(),
  profile_id        uuid                    not null references public.profiles (id) on delete cascade,
  amount            integer                 not null,   -- (+) recarga / (-) consumo
  transaction_type  public.transaction_type_t not null,
  ad_id             uuid                    references public.ads (id) on delete set null,
  created_at        timestamptz             not null default now()
);

comment on table public.credit_transactions is 'Auditoría de créditos. Solo se inserta desde RPCs SECURITY DEFINER.';


-- ---------------------------------------------------------------------------
-- chat_rooms — una sala por (anuncio, sesión de cliente anónimo).
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- chat_messages — mensajes de una sala.
-- ---------------------------------------------------------------------------
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
-- §3 — ÍNDICES (optimización del feed por ciudad/bump y del chat)
-- =====================================================================================

-- Feed por ciudad, solo anuncios activos, ordenado por posicionamiento.
create index if not exists idx_ads_city_bumped_active
  on public.ads (city_id, bumped_at desc)
  where status = 'active';

-- Feed global de activos.
create index if not exists idx_ads_bumped_active
  on public.ads (bumped_at desc)
  where status = 'active';

-- "Mis anuncios".
create index if not exists idx_ads_profile on public.ads (profile_id);

-- Historial de chat por sala.
create index if not exists idx_chat_messages_room_created
  on public.chat_messages (room_id, created_at desc);

-- Contador de no leídos (badges) para el anunciante.
create index if not exists idx_chat_messages_unread
  on public.chat_messages (room_id)
  where is_read = false;

-- Movimientos de un perfil.
create index if not exists idx_credit_tx_profile_created
  on public.credit_transactions (profile_id, created_at desc);

-- Salas del anunciante.
create index if not exists idx_chat_rooms_advertiser on public.chat_rooms (advertiser_id);

-- Soporte de la purga por inactividad.
create index if not exists idx_chat_rooms_purge on public.chat_rooms (updated_at, is_active);


-- =====================================================================================
-- §4 — FUNCIONES AUXILIARES
-- =====================================================================================

-- ¿El JWT actual pertenece a un administrador? (app_metadata.role = 'admin')
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

comment on function public.is_admin() is 'TRUE si el JWT trae app_metadata.role = admin.';


-- Trigger genérico para mantener updated_at.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =====================================================================================
-- §5 — TRIGGERS
-- =====================================================================================

-- updated_at automático.
drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.chat_rooms;
create trigger set_updated_at
  before update on public.chat_rooms
  for each row execute function public.tg_set_updated_at();


-- Creación automática del perfil al registrarse un usuario en Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, account_status)
  values (
    new.id,
    -- username desde metadata, con fallback determinista basado en el UUID.
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
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- Blindaje: impedir que el saldo se altere con un UPDATE directo desde la API.
-- Dentro de las RPCs SECURITY DEFINER, current_user es el owner (postgres) y pasan el check.
-- Vía PostgREST, current_user es `authenticated`/`anon` y se bloquea cualquier cambio de saldo.
create or replace function public.tg_guard_credit_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
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
create trigger guard_credit_balance
  before update on public.profiles
  for each row execute function public.tg_guard_credit_balance();


-- =====================================================================================
-- §6 — ROW LEVEL SECURITY (RLS) + POLÍTICAS
-- =====================================================================================
alter table public.cities              enable row level security;
alter table public.profiles            enable row level security;
alter table public.ads                 enable row level security;
alter table public.ads_verification    enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.chat_rooms          enable row level security;
alter table public.chat_messages       enable row level security;

-- ---- cities -------------------------------------------------------------------------
drop policy if exists cities_select_public on public.cities;
create policy cities_select_public on public.cities
  for select to anon, authenticated using (true);

drop policy if exists cities_admin_write on public.cities;
create policy cities_admin_write on public.cities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- profiles -----------------------------------------------------------------------
-- anon: sin acceso. authenticated: solo su propio perfil.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- (No se define INSERT: lo hace el trigger handle_new_user con SECURITY DEFINER.
--  No se define DELETE: la baja del usuario cae por cascada desde auth.users.)

-- ---- ads ----------------------------------------------------------------------------
-- Lectura pública de activos (incl. anon) + el dueño ve también sus borradores.
drop policy if exists ads_select_active_public on public.ads;
create policy ads_select_active_public on public.ads
  for select to anon, authenticated using (status = 'active');

drop policy if exists ads_select_own on public.ads;
create policy ads_select_own on public.ads
  for select to authenticated using (profile_id = auth.uid());

-- Escritura solo del dueño.
drop policy if exists ads_insert_own on public.ads;
create policy ads_insert_own on public.ads
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists ads_update_own on public.ads;
create policy ads_update_own on public.ads
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists ads_delete_own on public.ads;
create policy ads_delete_own on public.ads
  for delete to authenticated using (profile_id = auth.uid());

-- ---- ads_verification ---------------------------------------------------------------
-- Lectura pública (mostrar el sello). Escritura SOLO administradores.
drop policy if exists adsverif_select_public on public.ads_verification;
create policy adsverif_select_public on public.ads_verification
  for select to anon, authenticated using (true);

drop policy if exists adsverif_admin_write on public.ads_verification;
create policy adsverif_admin_write on public.ads_verification
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- credit_transactions ------------------------------------------------------------
-- Solo lectura del dueño o admin. Sin INSERT/UPDATE/DELETE directos (se escribe vía RPC).
drop policy if exists credittx_select_own on public.credit_transactions;
create policy credittx_select_own on public.credit_transactions
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());

-- ---- chat_rooms ---------------------------------------------------------------------
-- Solo el anunciante dueño ve/gestiona sus salas. anon NO tiene acceso directo (usa RPC §7).
drop policy if exists chatrooms_advertiser_select on public.chat_rooms;
create policy chatrooms_advertiser_select on public.chat_rooms
  for select to authenticated using (advertiser_id = auth.uid());

drop policy if exists chatrooms_advertiser_update on public.chat_rooms;
create policy chatrooms_advertiser_update on public.chat_rooms
  for update to authenticated using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());

-- ---- chat_messages ------------------------------------------------------------------
-- El anunciante lee y escribe mensajes de SUS salas. anon usa RPC §7.
drop policy if exists chatmsg_advertiser_select on public.chat_messages;
create policy chatmsg_advertiser_select on public.chat_messages
  for select to authenticated using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = chat_messages.room_id and r.advertiser_id = auth.uid()
    )
  );

drop policy if exists chatmsg_advertiser_insert on public.chat_messages;
create policy chatmsg_advertiser_insert on public.chat_messages
  for insert to authenticated with check (
    sender_type = 'advertiser'
    and exists (
      select 1 from public.chat_rooms r
      where r.id = chat_messages.room_id and r.advertiser_id = auth.uid()
    )
  );

drop policy if exists chatmsg_advertiser_update on public.chat_messages;
create policy chatmsg_advertiser_update on public.chat_messages
  for update to authenticated using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = chat_messages.room_id and r.advertiser_id = auth.uid()
    )
  );


-- =====================================================================================
-- §7 — RPCs DEL CHAT ANÓNIMO (SECURITY DEFINER)
--   Toda la operativa del cliente fantasma pasa por aquí. Las tablas de chat NO se
--   exponen a `anon`; estas funciones validan el p_session_id contra la sala.
-- =====================================================================================

-- Obtiene (o crea) la sala para (anuncio, sesión). Idempotente.
create or replace function public.fn_get_or_create_chat_room(
  p_ad_id      uuid,
  p_session_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_advertiser uuid;
  v_room_id    uuid;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    raise exception 'session_id inválido' using errcode = 'invalid_parameter_value';
  end if;

  -- El anuncio debe existir y estar activo.
  select a.profile_id into v_advertiser
  from public.ads a
  where a.id = p_ad_id and a.status = 'active';

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


-- Envía un mensaje del cliente; valida que la sesión sea la dueña de la sala.
create or replace function public.fn_send_client_message(
  p_room_id    uuid,
  p_session_id text,
  p_text       text
)
returns bigint
language plpgsql
security definer
set search_path = ''
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

  -- La sesión debe coincidir EXACTAMENTE con la sala (y estar activa).
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


-- Devuelve el historial de la sala validando la sesión del cliente.
create or replace function public.fn_get_messages(
  p_room_id    uuid,
  p_session_id text
)
returns setof public.chat_messages
language plpgsql
security definer
set search_path = ''
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
    where m.room_id = p_room_id
    order by m.created_at asc;
end;
$$;


-- Marca como leídos los mensajes del anunciante (los que el cliente recibe).
create or replace function public.fn_mark_read_by_client(
  p_room_id    uuid,
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_rooms r
    where r.id = p_room_id and r.client_session_id = p_session_id
  ) then
    raise exception 'Sesión no autorizada para esta sala' using errcode = 'insufficient_privilege';
  end if;

  update public.chat_messages
  set is_read = true
  where room_id = p_room_id and sender_type = 'advertiser' and is_read = false;
end;
$$;


-- =====================================================================================
-- §8 — RPCs DE MONETIZACIÓN (SECURITY DEFINER, transaccional con bloqueo de fila)
-- =====================================================================================

-- fn_bump_ad — posiciona el anuncio cobrando créditos.
create or replace function public.fn_bump_ad(target_ad_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_bump_cost constant integer := 5;     -- costo fijo del bump
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_balance   integer;
  v_bumped_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Se requiere autenticación' using errcode = 'insufficient_privilege';
  end if;

  -- El anuncio debe pertenecer al invocador.
  select profile_id into v_owner from public.ads where id = target_ad_id;
  if v_owner is null then
    raise exception 'El anuncio no existe' using errcode = 'no_data_found';
  end if;
  if v_owner <> v_uid then
    raise exception 'No eres el dueño de este anuncio' using errcode = 'insufficient_privilege';
  end if;

  -- Bloquea la fila del perfil para evitar condiciones de carrera con el saldo.
  select credit_balance into v_balance
  from public.profiles where id = v_uid
  for update;

  if v_balance < c_bump_cost then
    raise exception 'Saldo insuficiente: el bump cuesta % créditos y dispones de %.',
      c_bump_cost, v_balance
      using errcode = 'insufficient_resources';
  end if;

  -- Debita, audita y posiciona, todo en la misma transacción.
  update public.profiles
    set credit_balance = credit_balance - c_bump_cost
    where id = v_uid;

  insert into public.credit_transactions (profile_id, amount, transaction_type, ad_id)
  values (v_uid, -c_bump_cost, 'ad_bump', target_ad_id);

  update public.ads
    set bumped_at = now()
    where id = target_ad_id
    returning bumped_at into v_bumped_at;

  return v_bumped_at;
end;
$$;

comment on function public.fn_bump_ad(uuid) is 'Cobra 5 créditos y empuja el anuncio al inicio del feed (bumped_at = now()).';


-- fn_publish_ad — cobra al publicar y activa el anuncio (transaction_type = ad_publish).
create or replace function public.fn_publish_ad(target_ad_id uuid)
returns public.ad_status_t
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_publish_cost constant integer := 10;   -- costo fijo de publicación
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
    return v_status;  -- ya está publicado; no se vuelve a cobrar
  end if;

  select credit_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < c_publish_cost then
    raise exception 'Saldo insuficiente: publicar cuesta % créditos y dispones de %.',
      c_publish_cost, v_balance
      using errcode = 'insufficient_resources';
  end if;

  update public.profiles set credit_balance = credit_balance - c_publish_cost where id = v_uid;

  insert into public.credit_transactions (profile_id, amount, transaction_type, ad_id)
  values (v_uid, -c_publish_cost, 'ad_publish', target_ad_id);

  update public.ads
    set status = 'active', bumped_at = now()
    where id = target_ad_id
    returning status into v_status;

  return v_status;
end;
$$;

comment on function public.fn_publish_ad(uuid) is 'Cobra 10 créditos y pasa el anuncio a status = active.';


-- =====================================================================================
-- §9 — REALTIME BROADCAST (entrega en vivo del chat por canal privado)
--   Cliente y anunciante se suscriben al topic `room:<room_id>`.
--   El cliente usa SOLO Broadcast (no postgres_changes).
-- =====================================================================================

-- Al insertar un mensaje, emite un broadcast al canal privado de la sala.
create or replace function public.tg_broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id',          new.id,
      'room_id',     new.room_id,
      'sender_type', new.sender_type,
      'message_text', new.message_text,
      'created_at',  new.created_at
    ),
    'new_message',                   -- event
    'room:' || new.room_id::text,    -- topic (canal privado por sala)
    true                             -- private
  );
  return new;
end;
$$;

drop trigger if exists broadcast_message on public.chat_messages;
create trigger broadcast_message
  after insert on public.chat_messages
  for each row execute function public.tg_broadcast_message();


-- Autorización de canales privados: políticas sobre realtime.messages.
-- realtime.topic() devuelve el topic del canal al que se conecta el cliente.
alter table realtime.messages enable row level security;

-- Anunciante: lee/escribe el broadcast de la sala SOLO si es su advertiser_id.
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

-- Cliente anónimo: lee el broadcast de la sala si la sala existe.
-- El UUID de la sala (parte del topic) actúa como secreto/bearer.
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


-- =====================================================================================
-- §10 — PRIVACIDAD: AUTOLIMPIEZA DE CHATS FANTASMA
-- =====================================================================================
create or replace function public.fn_purge_old_anonymous_chats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_rooms integer;
begin
  -- Borra salas inactivas o sin actividad en 48h.
  -- chat_messages cae por ON DELETE CASCADE.
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

-- Agenda la purga cada hora (minuto 0). Reprograma si ya existe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-anon-chats') then
    perform cron.unschedule('purge-anon-chats');
  end if;
  perform cron.schedule(
    'purge-anon-chats',
    '0 * * * *',
    $cron$ select public.fn_purge_old_anonymous_chats(); $cron$
  );
end$$;


-- =====================================================================================
-- §11 — GRANTS (privilegios de objeto; RLS sigue mandando sobre las filas)
-- =====================================================================================

-- Catálogos / lectura pública.
grant select on public.cities           to anon, authenticated;
grant select on public.ads              to anon, authenticated;
grant select on public.ads_verification to anon, authenticated;

-- Anunciante (authenticated) sobre sus datos (RLS restringe a las filas propias).
grant select, insert, update, delete on public.ads      to authenticated;
grant select, update                 on public.profiles  to authenticated;
grant select                         on public.credit_transactions to authenticated;
grant select, update                 on public.chat_rooms    to authenticated;
grant select, insert, update         on public.chat_messages to authenticated;

-- El cliente anónimo NO toca tablas de chat: solo ejecuta las RPCs.
revoke all on public.chat_rooms    from anon;
revoke all on public.chat_messages from anon;

grant execute on function public.fn_get_or_create_chat_room(uuid, text) to anon, authenticated;
grant execute on function public.fn_send_client_message(uuid, text, text) to anon, authenticated;
grant execute on function public.fn_get_messages(uuid, text)            to anon, authenticated;
grant execute on function public.fn_mark_read_by_client(uuid, text)     to anon, authenticated;

-- Monetización: solo anunciantes.
grant execute on function public.fn_bump_ad(uuid)    to authenticated;
grant execute on function public.fn_publish_ad(uuid) to authenticated;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN
-- =====================================================================================
