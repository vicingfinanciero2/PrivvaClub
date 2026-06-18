-- =====================================================================================
--  PrivvaClub — Migración 0006: Blindaje de seguridad y rendimiento (linter)
--
--  Resuelve hallazgos del database linter (get_advisors):
--    §1 — REVOKE EXECUTE de RPCs sensibles a public/anon (y de funciones internas
--         de trigger / la purga, que no deben ser endpoints).
--    §2 — Índices de cobertura para las FK señaladas.
--    §3 — Optimización RLS de profiles: auth.uid() -> (select auth.uid()).
--    §4 — search_path fijo en tg_set_updated_at.
--
--  Idempotente. Depende de 0001/0004/0005.
-- =====================================================================================


-- =====================================================================================
-- §1 — REVOKE EXECUTE (reduce la superficie del API expuesto por PostgREST)
-- =====================================================================================

-- Monetización / verificación: solo `authenticated` (el grant ya existe en 0001/0004).
revoke execute on function public.fn_bump_ad(uuid)                        from public, anon;
revoke execute on function public.fn_publish_ad(uuid)                     from public, anon;
revoke execute on function public.fn_verify_ad_by_admin(uuid, boolean)    from public, anon;

-- La purga NO debe ser invocable por clientes; solo corre vía pg_cron / service_role.
revoke execute on function public.fn_purge_old_anonymous_chats()          from public, anon, authenticated;

-- Funciones de trigger: nunca deben llamarse como RPC.
revoke execute on function public.handle_new_user()                       from public, anon, authenticated;
revoke execute on function public.tg_broadcast_message()                  from public, anon, authenticated;
revoke execute on function public.tg_guard_credit_balance()               from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at()                     from public, anon, authenticated;

-- Helper de suscripción: no necesita estar expuesto a anon.
revoke execute on function public.has_active_subscription(uuid)           from anon;


-- =====================================================================================
-- §2 — ÍNDICES DE COBERTURA PARA FK
-- =====================================================================================
create index if not exists idx_subscription_events_profile
  on public.subscription_events (profile_id);

create index if not exists idx_credit_tx_ad
  on public.credit_transactions (ad_id);

create index if not exists idx_ads_verification_verified_by
  on public.ads_verification (verified_by);


-- =====================================================================================
-- §3 — OPTIMIZACIÓN RLS DE profiles
--   (select auth.uid()) se evalúa una sola vez (initplan), no por fila.
-- =====================================================================================
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);


-- =====================================================================================
-- §4 — search_path FIJO EN tg_set_updated_at
-- =====================================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
-- (Los triggers existentes siguen apuntando a esta función; no hace falta recrearlos.)

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0006
--
--  Pendientes que NO son SQL puro / quedan para una pasada aparte:
--    - Activar "Leaked Password Protection" en Dashboard -> Auth (no se puede por SQL).
--    - (Opcional) Endurecer el bucket ad-images quitando el SELECT amplio de listado,
--      y aplicar (select auth.uid()) al resto de políticas (ads, chat_*, etc.).
-- =====================================================================================
