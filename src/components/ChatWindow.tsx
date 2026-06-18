// =====================================================================================
//  PrivvaClub — Ventana de chat anónimo (modal flotante)
//
//  Consume useChatRoom(roomId, sessionId): pinta los globos diferenciando client /
//  advertiser, hace auto-scroll al último mensaje y envía texto saneado por la barra
//  inferior. El cliente es 100% anónimo (opera solo con su sessionId).
// =====================================================================================

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatRoom } from "../hooks/useChatRoom";

interface ChatWindowProps {
  roomId: string;
  sessionId: string;
  /** Título contextual (p. ej. el título del anuncio). */
  title?: string;
  onClose: () => void;
}

/** Saneo básico anti-XSS antes de enviar (defensa en profundidad; la DB acota longitud). */
function sanitize(input: string): string {
  return input.replace(/[<>]/g, "").trim();
}

export default function ChatWindow({ roomId, sessionId, title, onClose }: ChatWindowProps) {
  const { messages, loading, error, sendMessage } = useChatRoom(roomId, sessionId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje cuando cambian los mensajes.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = sanitize(draft);
    if (!text || sending) return;
    setSending(true);
    try {
      await sendMessage(text);
      setDraft("");
    } catch {
      // El error ya queda reflejado en el estado del hook.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="chat-window" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="chat-header">
          <div>
            <div className="chat-header-title">{title ?? "Chat anónimo"}</div>
            <div className="chat-header-sub">🔒 Conversación privada y efímera</div>
          </div>
          <button className="chat-close" onClick={onClose} aria-label="Cerrar chat">
            ✕
          </button>
        </header>

        {/* Mensajes */}
        <div className="chat-messages" ref={scrollRef}>
          {loading && <div className="state">Cargando conversación…</div>}
          {error && <div className="state error">{error.message}</div>}
          {!loading && !error && messages.length === 0 && (
            <div className="state">Escribe el primer mensaje. Eres anónimo. 👻</div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.sender_type === "client" ? "bubble-client" : "bubble-advertiser"}`}
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

        {/* Input */}
        <form className="chat-input-bar" onSubmit={handleSubmit}>
          <input
            type="text"
            className="chat-input"
            placeholder="Escribe un mensaje…"
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
