-- =====================================================================================
--  PrivvaClub — Seed para el EDITOR SQL de Supabase (entorno cloud)
--
--  Pega y ejecuta este script en: Dashboard -> SQL Editor -> New query.
--  Requiere que las migraciones 0001–0004 ya estén aplicadas.
--
--  Idempotente: borra solo los usuarios semilla (UUIDs fijos) y el ON DELETE CASCADE
--  arrastra perfiles, anuncios, verificaciones y chats. Se puede correr varias veces.
--
--  Diferencia con supabase/seed.sql: aquel es para `supabase db reset` (local);
--  este está pensado para ejecutarlo a mano contra el proyecto en la nube.
-- =====================================================================================

-- =====================================================================================
-- §1 — CIUDADES  (upsert; si las migraciones ya las sembraron, no duplica)
-- =====================================================================================
insert into public.cities (name, slug, sort_order) values
  ('Bogotá',       'bogota',       1),
  ('Medellín',     'medellin',     2),
  ('Cali',         'cali',         3),
  ('Barranquilla', 'barranquilla', 4),
  ('Bucaramanga',  'bucaramanga',  5),
  ('Cartagena',    'cartagena',    6),
  ('Pereira',      'pereira',      7)
on conflict (slug) do nothing;


-- =====================================================================================
-- §2 — PERFILES DE PRUEBA (anunciantes)
--   Se insertan en auth.users (el trigger handle_new_user crea los profiles).
--   Contraseña de prueba: "Password123!".
-- =====================================================================================
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

-- Saldo y estado (el seed corre como postgres, el guard de saldo lo permite).
update public.profiles set account_status = 'active', credit_balance = 200 where id = 'b1000000-0000-0000-0000-000000000001';
update public.profiles set account_status = 'active', credit_balance = 350 where id = 'b1000000-0000-0000-0000-000000000002';


-- =====================================================================================
-- §3 — ANUNCIOS (4 activos: 2 en Bogotá, 2 en Medellín)
--   Imágenes simuladas de Unsplash. city_id resuelto por slug.
-- =====================================================================================
insert into public.ads (
  id, profile_id, title, description, price, city_id, zone_neighborhood, age,
  image_urls, status, bumped_at, created_at
)
values
  -- ad1 — Bogotá, adv A (verificado).
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Sofía — Acompañamiento exclusivo', 'Trato elegante y discreto. Disponibilidad nocturna en zona norte.',
   350000, (select id from public.cities where slug = 'bogota'), 'Chapinero', 24,
   array[
     'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80',
     'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80'
   ],
   'active', now() - interval '2 minutes', now() - interval '2 days'),

  -- ad2 — Bogotá, adv B (sin verificar).
  ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',
   'Camila — Experiencia premium', 'Atención personalizada, ambiente privado y cómodo.',
   400000, (select id from public.cities where slug = 'bogota'), 'Usaquén', 26,
   array[
     'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80'
   ],
   'active', now() - interval '40 minutes', now() - interval '1 day'),

  -- ad3 — Medellín, adv A (verificado).
  ('c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001',
   'Sofía — Disponible en El Poblado', 'Encuentros exclusivos, máxima discreción.',
   300000, (select id from public.cities where slug = 'medellin'), 'El Poblado', 24,
   array[
     'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=80'
   ],
   'active', now() - interval '15 minutes', now() - interval '3 days'),

  -- ad4 — Medellín, adv B (sin verificar).
  ('c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000002',
   'Camila — Atención inmediata', 'Zona Laureles, ambiente relajado y privado.',
   250000, (select id from public.cities where slug = 'medellin'), 'Laureles', 27,
   array[
     'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80'
   ],
   'active', now() - interval '3 hours', now() - interval '12 hours');


-- =====================================================================================
-- §4 — VERIFICACIONES (sello de estudio para 2 anuncios)
-- =====================================================================================
insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
values
  ('c1000000-0000-0000-0000-000000000001', true, now() - interval '1 day', null),
  ('c1000000-0000-0000-0000-000000000003', true, now() - interval '2 days', null)
on conflict (ad_id) do update
  set is_verified_by_studio = excluded.is_verified_by_studio,
      verified_at = excluded.verified_at;

-- =====================================================================================
--  FIN DEL SEED (cloud)
--  Resultado: 7 ciudades, 2 anunciantes (200 / 350 créditos), 4 anuncios activos
--  (2 Bogotá, 2 Medellín; 2 verificados). Login demo: <email> / Password123!
-- =====================================================================================
