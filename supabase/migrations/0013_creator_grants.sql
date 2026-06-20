-- =====================================================================================
--  PrivvaClub — Migración 0013: GRANTs faltantes para creator_applications
--
--  0012 creó la tabla + RLS pero no concedió privilegios de tabla al rol `authenticated`.
--  PostgREST exige GRANT *además* de la política RLS -> de ahí el "permission denied".
--  (La RLS sigue restringiendo las filas; el grant solo habilita el verbo SQL.)
-- =====================================================================================

grant select, insert, update on public.creator_applications to authenticated;

-- De paso, subscription_events (0005) tiene RLS de lectura pero tampoco se concedió.
grant select on public.subscription_events to authenticated;

-- =====================================================================================
--  FIN 0013
-- =====================================================================================
