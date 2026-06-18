-- =====================================================================================
--  PrivvaClub — Migración 0004: Verificación oficial de anuncios (administración)
--
--  Gestiona el "sello de estudio" (ads_verification.is_verified_by_studio): la marca
--  que indica que las fotos fueron tomadas por el fotógrafo oficial de la plataforma.
--
--  Esta RPC es el ÚNICO camino para alterar la verificación. Concuerda con las políticas
--  RLS de 0001 (ads_verification: lectura pública, escritura solo is_admin()), pero al
--  centralizar la lógica en una función:
--    - se sella el verified_by/verified_at de forma consistente, y
--    - el anunciante nunca recibe permisos de escritura sobre la tabla.
--
--  Depende de 0001_init_schema.sql (ads, ads_verification, public.is_admin()).
-- =====================================================================================


-- =====================================================================================
-- §1 — RPC DE VERIFICACIÓN (SECURITY DEFINER)
--   fn_verify_ad_by_admin(p_ad_id, p_is_verified):
--     - p_is_verified = TRUE  -> activa el sello (upsert) y sella auditoría.
--     - p_is_verified = FALSE -> retira el sello conservando el historial.
--   Devuelve el estado final de is_verified_by_studio.
-- =====================================================================================
create or replace function public.fn_verify_ad_by_admin(
  p_ad_id       uuid,
  p_is_verified boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin  uuid := auth.uid();
  v_result boolean;
begin
  -- ---- §2a — Control de acceso: solo administradores --------------------------------
  -- is_admin() lee app_metadata.role del JWT del invocador (válido también dentro de
  -- una función SECURITY DEFINER, porque auth.jwt() refleja al usuario que llama).
  if not public.is_admin() then
    raise exception 'Acceso denegado: se requiere rol de administrador.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- §2b — El anuncio debe existir ------------------------------------------------
  if not exists (select 1 from public.ads where id = p_ad_id) then
    raise exception 'El anuncio no existe (%).', p_ad_id
      using errcode = 'no_data_found';
  end if;

  -- ---- §2c — Aplicar o retirar la verificación --------------------------------------
  if p_is_verified then
    -- UPSERT: activa el sello y sella quién/cuándo verificó.
    insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
    values (p_ad_id, true, now(), v_admin)
    on conflict (ad_id) do update
      set is_verified_by_studio = true,
          verified_at           = now(),
          verified_by           = v_admin;
  else
    -- Retira el sello conservando el registro (mejor trazabilidad que borrar la fila).
    insert into public.ads_verification (ad_id, is_verified_by_studio, verified_at, verified_by)
    values (p_ad_id, false, null, v_admin)
    on conflict (ad_id) do update
      set is_verified_by_studio = false,
          verified_at           = null,
          verified_by           = v_admin;   -- deja traza del admin que lo retiró
  end if;

  select is_verified_by_studio into v_result
  from public.ads_verification where ad_id = p_ad_id;

  return v_result;
end;
$$;

comment on function public.fn_verify_ad_by_admin(uuid, boolean) is
  'Activa/retira el sello de verificación de un anuncio. Solo administradores (is_admin()).';


-- =====================================================================================
-- §3 — PROTECCIÓN DEL ENDPOINT
--   Se revoca al público y a anon. Se concede a authenticated: el filtro interno
--   is_admin() rechaza a los anunciantes comunes, así que solo los admin pasan.
-- =====================================================================================
revoke execute on function public.fn_verify_ad_by_admin(uuid, boolean)
  from public, anon;

grant execute on function public.fn_verify_ad_by_admin(uuid, boolean)
  to authenticated;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0004
--
--  Uso desde el panel de administración (supabase-js, sesión de un admin):
--      const { data, error } = await supabase.rpc('fn_verify_ad_by_admin', {
--        p_ad_id: adId,
--        p_is_verified: true,   // o false para retirar el sello
--      });
--      // data = estado final de is_verified_by_studio
--  Recuerda: el rol admin se asigna seteando app_metadata.role = 'admin' en el usuario
--  (vía service_role / Admin API), no desde el cliente.
-- =====================================================================================
