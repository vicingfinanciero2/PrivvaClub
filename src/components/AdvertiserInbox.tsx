// =====================================================================================
//  PrivvaClub — Bandeja de entrada del anunciante (tiempo real)
//
//  Lista las salas del anunciante con: anuncio relacionado, extracto del último mensaje
//  y contador de NO LEÍDOS. Escucha chat_messages vía postgres_changes (acotado por RLS
//  a las salas propias): al llegar un mensaje del cliente, incrementa el contador y sube
//  la sala al tope, en vivo. Abrir una sala despliega la conversación (AdvertiserChat).
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { inboxService, type InboxRoom } from "../services/inboxService";
import AdvertiserChat from "./AdvertiserChat";
import type { ChatMessage } from "../types/supabase";

interface AdvertiserInboxProps {
  userId: string;
}

export default function AdvertiserInbox({ userId }: AdvertiserInboxProps) {
  const [rooms, setRooms] = useState<InboxRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<InboxRoom | null>(null);

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inboxService.getInbox(userId);
      if (mountedRef.current) setRooms(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la bandeja");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  // Carga inicial.
  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Suscripción en vivo a los mensajes (RLS limita a las salas del anunciante).
  useEffect(() => {
    const channel = supabase
      .channel(`inbox:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          if (!mountedRef.current) return;
          const m = payload.new as ChatMessage;

          setRooms((prev) => {
            const idx = prev.findIndex((r) => r.roomId === m.room_id);
            if (idx === -1) {
              // Sala nueva (primer mensaje de un cliente que aún no teníamos): recargar.
              void load();
              return prev;
            }
            const room = prev[idx];
            const updated: InboxRoom = {
              ...room,
              lastMessage: m.message_text,
              lastMessageAt: m.created_at,
              lastSender: m.sender_type,
              // Solo cuenta como no leído si lo manda el cliente y el chat no está abierto.
              unreadCount:
                m.sender_type === "client" && open?.roomId !== m.room_id
                  ? room.unreadCount + 1
                  : room.unreadCount,
              updatedAt: m.created_at,
            };
            // Reordenar: la sala con actividad sube al tope.
            const rest = prev.filter((_, i) => i !== idx);
            return [updated, ...rest];
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load, open]);

  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadCount, 0);

  function openRoom(room: InboxRoom) {
    setOpen(room);
  }

  function handleRead(roomId: string) {
    setRooms((prev) =>
      prev.map((r) => (r.roomId === roomId ? { ...r, unreadCount: 0 } : r)),
    );
  }

  return (
    <>
      <div className="section-title inbox-title">
        Bandeja de chats
        {totalUnread > 0 && <span className="unread-badge">{totalUnread}</span>}
      </div>

      {loading && <div className="state">Cargando bandeja…</div>}
      {error && <div className="state error">{error}</div>}
      {!loading && !error && rooms.length === 0 && (
        <div className="state">Aún no tienes conversaciones. Aparecerán aquí en tiempo real.</div>
      )}

      {rooms.map((r) => (
        <button
          key={r.roomId}
          className={`card inbox-row${r.unreadCount > 0 ? " unread" : ""}`}
          onClick={() => openRoom(r)}
        >
          <div className="inbox-main">
            <div className="inbox-head">
              <span className="card-title">{r.adTitle}</span>
              {r.lastMessageAt && (
                <span className="inbox-time">
                  {new Date(r.lastMessageAt).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            <div className="inbox-excerpt muted">
              {r.lastSender === "advertiser" && "Tú: "}
              {r.lastMessage ?? "Sin mensajes"}
            </div>
          </div>
          {r.unreadCount > 0 && <span className="unread-badge">{r.unreadCount}</span>}
        </button>
      ))}

      {open && (
        <AdvertiserChat
          roomId={open.roomId}
          adTitle={open.adTitle}
          onClose={() => setOpen(null)}
          onRead={handleRead}
        />
      )}
    </>
  );
}
