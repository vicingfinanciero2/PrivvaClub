-- =====================================================================================
--  PrivvaClub — Migración 0003: Motor de recargas de créditos (pasarela de pagos)
--
--  Implementa el "libro mayor" de depósitos. La pasarela (Stripe, Wompi, MercadoPago,
--  PayU, etc.) confirma el pago vía webhook → una Edge Function valida la firma y, con
--  la `service_role` key, invoca esta RPC para acreditar los créditos.
--
--  Garantías:
--    - TRANSACCIONALIDAD: bloqueo de fila (SELECT ... FOR UPDATE) sobre el perfil para
--      evitar condiciones de carrera entre webhooks simultáneos del mismo anunciante.
--    - IDEMPOTENCIA: el id de transacción de la pasarela (p_transaction_id) se guarda
--      como external_ref UNIQUE. Si el webhook se reintenta, NO se acredita dos veces.
--    - BLINDAJE: solo `service_role` puede ejecutar la función (revocada a todos los demás).
--
--  Depende de 0001_init_schema.sql (profiles, credit_transactions, transaction_type_t).
-- =====================================================================================


-- =====================================================================================
-- §0 — IDEMPOTENCIA: referencia externa en el libro mayor
--   Vincula cada movimiento con el id de transacción de la pasarela. UNIQUE como
--   backstop a nivel de motor contra acreditaciones duplicadas.
-- =====================================================================================
alter table public.credit_transactions
  add column if not exists external_ref text;

comment on column public.credit_transactions.external_ref is
  'Id de transacción de la pasarela de pagos (idempotencia). Único cuando no es nulo.';

-- Único solo cuando hay referencia (consumos internos como ad_bump/ad_publish la dejan nula).
create unique index if not exists uq_credit_tx_external_ref
  on public.credit_transactions (external_ref)
  where external_ref is not null;


-- =====================================================================================
-- §1 — RPC INTERNA DE DEPÓSITO (SECURITY DEFINER)
--   Acredita créditos a un anunciante. Pensada para ser invocada SOLO por servicios
--   de confianza (service_role) tras validar el pago.
-- =====================================================================================
create or replace function public.fn_deposit_credits_by_admin(
  p_profile_id     uuid,
  p_amount         integer,
  p_transaction_id text
)
returns integer                      -- devuelve el nuevo saldo (credit_balance)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_balance integer;
begin
  -- ---- §3a — Validaciones de entrada -------------------------------------------------
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a acreditar debe ser positivo (recibido: %).', p_amount
      using errcode = 'invalid_parameter_value';
  end if;

  if p_transaction_id is null or length(btrim(p_transaction_id)) = 0 then
    raise exception 'Se requiere el id de transacción de la pasarela (idempotencia).'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- §2 — Bloqueo transaccional de la fila del anunciante --------------------------
  -- FOR UPDATE serializa webhooks concurrentes del mismo perfil: el segundo espera
  -- a que el primero confirme antes de continuar.
  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'El perfil destino no existe (%).', p_profile_id
      using errcode = 'no_data_found';
  end if;

  -- ---- §3b — Idempotencia: ¿este pago ya fue acreditado? -----------------------------
  -- Tras el lock, si ya existe el movimiento devolvemos el saldo actual sin re-acreditar.
  if exists (
    select 1 from public.credit_transactions where external_ref = p_transaction_id
  ) then
    select credit_balance into v_new_balance from public.profiles where id = p_profile_id;
    raise notice 'Transacción % ya procesada; no se acredita de nuevo.', p_transaction_id;
    return v_new_balance;
  end if;

  -- ---- §3c — Acreditar saldo y registrar en el libro mayor inmutable -----------------
  update public.profiles
    set credit_balance = credit_balance + p_amount
    where id = p_profile_id
    returning credit_balance into v_new_balance;

  insert into public.credit_transactions (profile_id, amount, transaction_type, external_ref)
  values (p_profile_id, p_amount, 'deposit', p_transaction_id);

  return v_new_balance;
end;
$$;

comment on function public.fn_deposit_credits_by_admin(uuid, integer, text) is
  'Acredita créditos (deposit) de forma transaccional e idempotente. Solo service_role.';


-- =====================================================================================
-- §4 — BLINDAJE DEL EJECUTOR
--   Por ser un cambio directo de saldo, se revoca a todos y se permite solo a
--   service_role (la key de servidor que usa la Edge Function del webhook).
-- =====================================================================================
revoke execute on function public.fn_deposit_credits_by_admin(uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.fn_deposit_credits_by_admin(uuid, integer, text)
  to service_role;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0003
--
--  Uso desde la Edge Function (Deno) tras validar la firma del webhook:
--      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
--      const { data, error } = await supabase.rpc('fn_deposit_credits_by_admin', {
--        p_profile_id: profileId,
--        p_amount: creditsPurchased,
--        p_transaction_id: gatewayEvent.id,   // id único del evento de la pasarela
--      });
--      // data = nuevo saldo; reintentos del webhook son seguros (idempotentes).
-- =====================================================================================
