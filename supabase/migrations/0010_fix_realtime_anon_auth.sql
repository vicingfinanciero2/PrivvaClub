-- =====================================================================================
--  PrivvaClub — Migración 0010: Fix de autorización Realtime para el cliente anónimo
--
--  Problema: la política rt_room_anon sobre realtime.messages hace
--    EXISTS (SELECT 1 FROM public.chat_rooms ...)
--  Cuando Realtime evalúa esa política como rol `anon`, ese subquery queda sujeto a la
--  RLS de chat_rooms, y `anon` NO puede leer chat_rooms (REVOKE ALL + sin policy).
--  => el EXISTS siempre es false => se deniega el canal privado => CHANNEL_ERROR.
--
--  Solución: una función SECURITY DEFINER que verifica la sala (saltándose la RLS de
--  chat_rooms de forma controlada) y se usa dentro de la política. El UUID de la sala
--  (parte del topic) sigue siendo el secreto/bearer: solo quien lo conoce se suscribe.
-- =====================================================================================

-- Helper: ¿el topic corresponde a una sala activa? (corre como owner -> sin RLS de anon)
create or replace function public.realtime_can_read_room(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_rooms r
    where 'room:' || r.id::text = p_topic
      and r.is_active
  );
$$;

comment on function public.realtime_can_read_room(text) is
  'Autorización de canal Broadcast: TRUE si el topic room:<uuid> es una sala activa.';

revoke execute on function public.realtime_can_read_room(text) from public;
grant execute on function public.realtime_can_read_room(text) to anon, authenticated;

-- Política del cliente anónimo reescrita con el helper (sin tocar chat_rooms directamente).
drop policy if exists rt_room_anon on realtime.messages;
create policy rt_room_anon on realtime.messages
  for select to anon using (
    realtime.messages.extension = 'broadcast'
    and public.realtime_can_read_room(realtime.topic())
  );

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0010
--  Tras aplicar: el cliente anónimo podrá unirse a room:<id> y recibir mensajes en vivo.
-- =====================================================================================
