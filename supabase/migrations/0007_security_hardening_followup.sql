-- =====================================================================================
--  PrivvaClub — Migración 0007: cierre de hallazgos restantes del linter
--
--    §1 — has_active_subscription: revocar de PUBLIC (no solo de anon).
--         El frontend NO la llama; fn_bump_ad/fn_publish_ad la usan internamente
--         (SECURITY DEFINER, corren como owner: no dependen de este grant).
--    §2 — Bucket ad-images: quitar el SELECT amplio que permite LISTAR objetos.
--         Un bucket público sirve las imágenes por URL sin esa política, así que
--         las <img src=publicUrl> siguen funcionando; solo se elimina el listado.
--
--  Recordatorio manual (no SQL): activar "Leaked Password Protection" en
--  Dashboard -> Authentication -> Policies (HaveIBeenPwned).
-- =====================================================================================

-- §1 — has_active_subscription fuera del API público.
revoke execute on function public.has_active_subscription(uuid) from public, anon, authenticated;

-- §2 — Endurecer el bucket: sin política de listado (las URLs públicas siguen OK).
drop policy if exists "ad_images_public_read" on storage.objects;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0007
-- =====================================================================================
