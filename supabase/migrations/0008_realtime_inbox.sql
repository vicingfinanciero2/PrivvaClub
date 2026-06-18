-- =====================================================================================
--  PrivvaClub — Migración 0008: Realtime para la bandeja del anunciante
--
--  El anunciante (authenticated) escucha sus mensajes vía postgres_changes, que respeta
--  la RLS existente (chatmsg_advertiser_select: solo mensajes de SUS salas). Para que
--  postgres_changes emita eventos, la tabla debe estar en la publicación supabase_realtime.
--
--  El cliente anónimo NO usa esto (sigue con Broadcast); y como anon no tiene SELECT
--  sobre chat_messages, no recibiría nada por este canal aunque lo intentara.
--
--  Idempotente y tolerante (no aborta si ya está añadida o si no hay privilegios).
-- =====================================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception when others then
  raise notice 'No se pudo añadir chat_messages a supabase_realtime (%). Actívalo en Database -> Replication.', sqlerrm;
end$$;

-- =====================================================================================
--  FIN DE LA MIGRACIÓN 0008
-- =====================================================================================
