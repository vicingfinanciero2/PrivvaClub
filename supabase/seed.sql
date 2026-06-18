-- =====================================================================================
--  PrivvaClub — seed.sql  (datos de prueba para entorno LOCAL)
--
--  Puebla el negocio de extremo a extremo: admin + anunciantes, anuncios en distintos
--  estados/ciudades, chats de clientes fantasma y una verificación de estudio.
--
--  Idempotente: al inicio borra SOLO los usuarios semilla (UUIDs fijos); el ON DELETE
--  CASCADE de auth.users arrastra profiles -> ads -> ads_verification / chat_rooms /
--  chat_messages / credit_transactions. Puede ejecutarse múltiples veces.
--
--  Ejecutar:  supabase db reset   (corre migraciones + este seed automáticamente)
--             o bien: psql ... -f supabase/seed.sql
--
--  Notas de coherencia con el esquema real (0001):
--    - `city` NO es enum: es city_id FK a public.cities -> se resuelve por slug.
--    - El estado "publicado" es el valor de enum `active` (no 'published').
--    - El trigger handle_new_user crea el profiles al insertar en auth.users; aquí
--      luego se ajustan saldo y estado (el seed corre como `postgres`, así que el
--      guard de saldo lo permite).
-- =====================================================================================

-- UUIDs fijos de referencia:
--   admin : a0000000-0000-0000-0000-000000000001
--   adv1  : b0000000-0000-0000-0000-000000000001   (0 créditos)
--   adv2  : b0000000-0000-0000-0000-000000000002   (50 créditos)
--   adv3  : b0000000-0000-0000-0000-000000000003   (500 créditos)

-- =====================================================================================
-- §0 — LIMPIEZA IDEMPOTENTE
-- =====================================================================================
delete from auth.users where id in (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000003'
);


-- =====================================================================================
-- §1 — PERFILES DE PRUEBA
--   Se insertan en auth.users (el trigger handle_new_user crea los profiles).
--   Contraseña común de prueba: "Password123!".
-- =====================================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  -- Administrador (app_metadata.role = 'admin' -> habilita is_admin()).
  ('00000000-0000-0000-0000-000000000000',
   'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'admin@privva.local', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb,
   '{"username":"admin_privva"}'::jsonb,
   '', '', '', ''),

  -- Anunciante 1 — 0 créditos.
  ('00000000-0000-0000-0000-000000000000',
   'b0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'valentina@privva.local', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"valentina_v"}'::jsonb,
   '', '', '', ''),

  -- Anunciante 2 — 50 créditos.
  ('00000000-0000-0000-0000-000000000000',
   'b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'sofia@privva.local', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"sofia_m"}'::jsonb,
   '', '', '', ''),

  -- Anunciante 3 — 500 créditos.
  ('00000000-0000-0000-0000-000000000000',
   'b0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'camila@privva.local', crypt('Password123!', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"camila_r"}'::jsonb,
   '', '', '', '');

-- Ajuste de saldo y estado de cuenta (el profile ya existe por el trigger).
update public.profiles set account_status = 'active', credit_balance = 0   where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set account_status = 'active', credit_balance = 0   where id = 'b0000000-0000-0000-0000-000000000001';
update public.profiles set account_status = 'active', credit_balance = 50  where id = 'b0000000-0000-0000-0000-000000000002';
update public.profiles set account_status = 'active', credit_balance = 500 where id = 'b0000000-0000-0000-0000-000000000003';

-- Movimientos 'deposit' coherentes con los saldos (libro mayor consistente).
insert into public.credit_transactions (profile_id, amount, transaction_type, external_ref)
values
  ('b0000000-0000-0000-0000-000000000002', 50,  'deposit', 'seed_deposit_adv2'),
  ('b0000000-0000-0000-0000-000000000003', 500, 'deposit', 'seed_deposit_adv3');


-- =====================================================================================
-- §2 — ANUNCIOS DE PRUEBA
--   city_id se resuelve por slug. image_urls apuntan a la ruta pública del bucket
--   `ad-images/<advertiser_uid>/<ad_id>/...` (Storage local en :54321).
-- =====================================================================================
insert into public.ads (
  id, profile_id, title, description, price, city_id, zone_neighborhood, age,
  image_urls, status, bumped_at, created_at
)
values
  -- ad1: ACTIVE en Bogotá (anunciante adv2) — será el verificado por estudio.
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'Sofía — Acompañamiento VIP', 'Disponibilidad nocturna, trato exclusivo y discreto.',
   350000, (select id from public.cities where slug = 'bogota'), 'Chapinero', 24,
   array[
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000002/c0000000-0000-0000-0000-000000000001/1.jpg',
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000002/c0000000-0000-0000-0000-000000000001/2.jpg'
   ],
   'active', now() - interval '5 minutes', now() - interval '3 days'),

  -- ad2: ACTIVE en Medellín (anunciante adv3).
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003',
   'Camila — Experiencia Premium', 'Atención personalizada en zona exclusiva.',
   400000, (select id from public.cities where slug = 'medellin'), 'El Poblado', 26,
   array[
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000003/c0000000-0000-0000-0000-000000000002/1.jpg'
   ],
   'active', now() - interval '1 hour', now() - interval '2 days'),

  -- ad3: DRAFT en Cali (anunciante adv2) — aún sin publicar.
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002',
   'Sofía — Borrador Cali', 'Anuncio en preparación, pendiente de publicar.',
   300000, (select id from public.cities where slug = 'cali'), 'Granada', 24,
   array[
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000002/c0000000-0000-0000-0000-000000000003/1.jpg'
   ],
   'draft', now(), now() - interval '6 hours'),

  -- ad4: ARCHIVED en Bogotá (anunciante adv3).
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003',
   'Camila — Anuncio Archivado', 'Campaña anterior ya finalizada.',
   280000, (select id from public.cities where slug = 'bogota'), 'Usaquén', 27,
   array[
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000003/c0000000-0000-0000-0000-000000000004/1.jpg'
   ],
   'archived', now() - interval '10 days', now() - interval '20 days'),

  -- ad5: ACTIVE en Medellín (anunciante adv1, sin créditos) — feed adicional.
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001',
   'Valentina — Disponible hoy', 'Atención inmediata, ambiente cómodo y privado.',
   250000, (select id from public.cities where slug = 'medellin'), 'Laureles', 23,
   array[
     'http://127.0.0.1:54321/storage/v1/object/public/ad-images/b0000000-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000005/1.jpg'
   ],
   'active', now() - interval '30 minutes', now() - interval '1 day');


-- =====================================================================================
-- §3 — INTERACCIONES DE CHAT (clientes fantasma)
--   client_session_id = hash aleatorio de ejemplo (lo que iría en localStorage).
--   chat_messages.id es identity -> no se inserta manualmente.
-- =====================================================================================
insert into public.chat_rooms (id, ad_id, advertiser_id, client_session_id, is_active, created_at, updated_at)
values
  -- Sala 1: cliente fantasma sobre ad1 (anunciante adv2).
  ('d0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'sess_3f9a1c7e8b2d4a6f90c1e2b3a4d5f6a7', true,
   now() - interval '2 hours', now() - interval '20 minutes'),

  -- Sala 2: cliente fantasma sobre ad2 (anunciante adv3).
  ('d0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003',
   'sess_a1b2c3d4e5f60718293a4b5c6d7e8f90', true,
   now() - interval '50 minutes', now() - interval '5 minutes');

-- Mensajes (mezcla de leídos y no leídos, de cliente y anunciante).
insert into public.chat_messages (room_id, sender_type, message_text, is_read, created_at)
values
  -- Sala 1 — conversación con respuesta del anunciante; el último del cliente sin leer.
  ('d0000000-0000-0000-0000-000000000001', 'client',     'Hola, ¿sigues disponible hoy?',          true,  now() - interval '2 hours'),
  ('d0000000-0000-0000-0000-000000000001', 'advertiser', 'Hola, sí. ¿Para qué horario te gustaría?', true,  now() - interval '110 minutes'),
  ('d0000000-0000-0000-0000-000000000001', 'client',     'Sobre las 9 pm. ¿Ubicación?',             false, now() - interval '20 minutes'),

  -- Sala 2 — cliente escribió, aún sin respuesta ni lectura del anunciante.
  ('d0000000-0000-0000-0000-000000000002', 'client',     'Buenas, ¿tarifa por la noche?',           false, now() - interval '50 minutes'),
  ('d0000000-0000-0000-0000-000000000002', 'client',     '¿Atiendes en El Poblado?',                false, now() - interval '5 minutes');


-- =====================================================================================
-- §4 — VERIFICACIÓN POR ESTUDIO
--   ad1 arranca con el sello oficial, verificado por el administrador.
-- =====================================================================================
insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
values
  ('c0000000-0000-0000-0000-000000000001', true, now() - interval '1 day',
   'a0000000-0000-0000-0000-000000000001');

-- =====================================================================================
--  FIN DEL SEED
--
--  Resumen de datos:
--    - 4 usuarios: admin (0), valentina (0), sofia (50), camila (500).
--    - 5 anuncios: 3 active (Bogotá, Medellín x2), 1 draft (Cali), 1 archived (Bogotá).
--    - 2 salas de chat con mensajes leídos/no leídos.
--    - 1 anuncio (ad1) con sello de verificación de estudio.
--  Login de prueba: <email>@privva.local / Password123!
-- =====================================================================================
