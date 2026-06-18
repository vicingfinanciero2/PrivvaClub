// =====================================================================================
//  PrivvaClub — Conversación del anunciante (modal de respuesta)
//
//  Carga el historial de la sala, escucha nuevos mensajes en vivo (postgres_changes,
//  filtrado por room_id y acotado por RLS), responde como 'advertiser' y marca como
//  leídos los mensajes del cliente al abrir.
//
//  Nota de UI: desde la óptica del anunciante, SUS mensajes van a la derecha. Reusamos
//  las clases de globo del cliente invirtiendo el mapeo (advertiser -> derecha/dorado).
// =====================================================================================

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { inboxService } from "../services/inboxService";
import type { ChatMessage } from "../types/supabase";

interface AdvertiserChatProps {
  roomId: string;
  adTitle: string;
  onClose: () => void;
  /** Se invoca al abrir (tras marcar leídos) para que la bandeja resetee el contador. */
  onRead: (roomId: string) => void;
}

function sanitize(input: string): string {
  return input.replace(/[<>]/g, "").trim();
}

export default function AdvertiserChat({ roomId, adTitle, onClose, onRead }: AdvertiserChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // 1) Historial + marcar leídos.
    inboxService
      .getRoomMessages(roomId)
      .then((history) => {
        if (mountedRef.current) setMessages(history);
        return inboxService.markRoomRead(roomId);
      })
      .then(() => onRead(roomId))
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Error al cargar la conversación");
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    // 2) Mensajes nuevos en vivo (postgres_changes filtrado por sala).
    const channel = supabase
      .channel(`adv-room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (!mountedRef.current) return;
          const m = payload.new as ChatMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          // Si entra un mensaje del cliente con el chat abierto, lo damos por leído.
          if (m.sender_type === "client") {
            void inboxService.markRoomRead(roomId);
          }
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, onRead]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = sanitize(draft);
    if (!text || sending) return;
    setSending(true);
    try {
      await inboxService.sendAdvertiserMessage(roomId, text);
      setDraft("");
      // El INSERT vuelve por postgres_changes y se pinta (dedup por id).
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="chat-window" onClick={(e) => e.stopPropagation()}>
        <header className="chat-header">
          <div>
            <div className="chat-header-title">{adTitle}</div>
            <div className="chat-header-sub">Cliente anónimo</div>
          </div>
          <button className="chat-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="chat-messages">
          {loading && <div className="state">Cargando conversación…</div>}
          {error && <div className="state error">{error}</div>}
          {!loading && !error && messages.length === 0 && (
            <div className="state">Sin mensajes todavía.</div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              /* advertiser = "mío" (derecha/dorado); client = "suyo" (izquierda/gris) */
              className={`bubble ${m.sender_type === "advertiser" ? "bubble-client" : "bubble-advertiser"}`}
            >
              <span className="bubble-text">{m.message_text}</span>
              <span className="bubble-time">
                {new Date(m.created_at).toLocaleTimeString("es-CO", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form className="chat-input-bar" onSubmit={handleSubmit}>
          <input
            type="text"
            className="chat-input"
            placeholder="Responder…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
            disabled={sending}
            autoFocus
          />
          <button className="chat-send" type="submit" disabled={sending || !draft.trim()}>
            {sending ? "…" : "Enviar"}
          </button>
        </form>
      </div>
    </div>
  );
}
