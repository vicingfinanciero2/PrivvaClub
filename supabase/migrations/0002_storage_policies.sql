-- =====================================================================================
--  PrivvaClub — Migración 0002: Almacenamiento de imágenes de anuncios (Storage)
--
--  Configura el bucket público `ad-images` y sus políticas RLS sobre storage.objects.
--  Las URLs resultantes se guardan en public.ads.image_urls (text[]) — ver 0001.
--
--  Modelo de seguridad del Storage:
--    - Cada anunciante sube SOLO dentro de su carpeta `ad-images/<auth.uid()>/...`,
--      de modo que no pueda crear/pisar archivos de otro anunciante.
--    - UPDATE/DELETE solo del dueño del objeto (owner = auth.uid()).
--    - Lectura pública (anon + authenticated) para renderizar el feed de clasificados.
--
--  Pegar en el editor SQL de Supabase y ejecutar (idempotente).
-- =====================================================================================


-- =====================================================================================
-- §1 — BUCKET
--   Bucket público. La columna `public = true` permite servir las imágenes por URL
--   pública sin firmar; el control de ESCRITURA lo imponen las políticas de §3.
-- =====================================================================================
insert into storage.buckets (id, name, public)
values ('ad-images', 'ad-images', true)
on conflict (id) do update set public = excluded.public;


-- =====================================================================================
-- §2 — HABILITAR RLS
--   (En Supabase suele venir activado; se asegura de forma explícita e idempotente.)
-- =====================================================================================
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- Lectura pública del catálogo de buckets (no expone objetos, solo metadatos del bucket).
drop policy if exists "ad_images_bucket_public_read" on storage.buckets;
create policy "ad_images_bucket_public_read" on storage.buckets
  for select to anon, authenticated
  using (id = 'ad-images');


-- =====================================================================================
-- §3 — POLÍTICAS SOBRE storage.objects (bucket `ad-images`)
-- =====================================================================================

-- ---- SELECT: lectura pública total (para renderizar las fotos en el feed) -----------
drop policy if exists "ad_images_public_read" on storage.objects;
create policy "ad_images_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'ad-images');

-- ---- INSERT: solo authenticated y solo en su propia carpeta `<auth.uid()>/...` ------
--   storage.foldername(name) devuelve el array de carpetas de la ruta del objeto;
--   el primer segmento debe ser el UID del anunciante.
drop policy if exists "ad_images_insert_own_folder" on storage.objects;
create policy "ad_images_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ad-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- UPDATE: solo el dueño del objeto, y debe mantenerlo en su propia carpeta -------
drop policy if exists "ad_images_update_own" on storage.objects;
create policy "ad_images_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ad-images'
    and owner = auth.uid()
  )
  with check (
    bucket_id = 'ad-images'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- DELETE: solo el dueño del objeto ----------------------------------------------
drop policy if exists "ad_images_delete_own" on storage.objects;
create policy "ad_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ad-images'
    and owner = auth.uid()
  );

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0002
--
--  Convención de ruta esperada desde el frontend (PWA):
--      ad-images/<auth.uid()>/<ad_id>/<filename>
--  Ejemplo de subida (supabase-js):
--      const path = `${user.id}/${adId}/${crypto.randomUUID()}.jpg`;
--      await supabase.storage.from('ad-images').upload(path, file);
--      const { data } = supabase.storage.from('ad-images').getPublicUrl(path);
--      // -> guarda data.publicUrl dentro de public.ads.image_urls
-- =====================================================================================
