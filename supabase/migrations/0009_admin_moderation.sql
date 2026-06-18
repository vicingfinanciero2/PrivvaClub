-- =====================================================================================
--  PrivvaClub — Migración 0009: RLS de moderación para administradores
--
--  Para el panel de verificación, un admin (is_admin() = app_metadata.role='admin')
--  necesita LEER todos los anuncios (cualquier status/dueño) y los perfiles de los
--  anunciantes. Se añaden políticas SELECT adicionales gateadas por is_admin().
--
--  La escritura del sello sigue siendo exclusiva de fn_verify_ad_by_admin (0004).
--  Nota: esto crea políticas permisivas extra (el linter marcará multiple_permissive
--  en SELECT para authenticated); es el trade-off esperado por dar visibilidad al admin.
-- =====================================================================================

-- Admin puede ver TODOS los anuncios (además de las políticas públicas/propias).
drop policy if exists ads_admin_select on public.ads;
create policy ads_admin_select on public.ads
  for select to authenticated using ((select public.is_admin()));

-- Admin puede ver los perfiles de los anunciantes (para mostrar quién publica).
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated using ((select public.is_admin()));

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0009
-- =====================================================================================
