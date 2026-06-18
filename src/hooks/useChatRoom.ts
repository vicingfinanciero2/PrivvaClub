// =====================================================================================
//  PrivvaClub — Hook reactivo del canal de chat
//
//  Para una sala dada:
//    1. Carga el historial inicial vía chatService (RPC validada por sessionId).
//    2. Se suscribe al canal PRIVADO de Realtime con el tópico exacto `room:<roomId>`.
//    3. Escucha el evento broadcast `new_message` (emitido por el trigger del backend
//       en cada INSERT) e inyecta el mensaje sin duplicados.
//    4. Expone messages, loading, error y un sendMessage de conveniencia.
//
//  La autorización del canal la imponen las políticas RLS sobre realtime.messages
//  (migración 0001 §9): el cliente anónimo entra si la sala existe (UUID = secreto).
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { chatService } from "../services/chatService";
import type { ChatMessage, SenderType } from "../types/supabase";

/** Forma del payload que emite el trigger tg_broadcast_message (0001 §9). */
interface BroadcastNewMessage {
  id: number;
  room_id: string;
  sender_type: SenderType;
  message_text: string;
  created_at: string;
}

export interface UseChatRoom {
  messages: ChatMessage[];
  loading: boolean;
  error: Error | null;
  /** Envía un mensaje del cliente; el broadcast lo reflejará en `messages`. */
  sendMessage: (text: string) => Promise<void>;
}

/** Inserta un mensaje en orden cronológico, evitando duplicados por id. */
function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  const next = [...list, incoming];
  next.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return next;
}

/** Mapea el payload del broadcast (sin is_read) a un ChatMessage completo. */
function fromBroadcast(payload: BroadcastNewMessage): ChatMessage {
  return {
    id: payload.id,
    room_id: payload.room_id,
    sender_type: payload.sender_type,
    message_text: payload.message_text,
    is_read: false,
    created_at: payload.created_at,
  };
}

/**
 * @param roomId    Id de la sala (null mientras aún no exista).
 * @param sessionId Identidad fantasma del cliente (de useAnonymousSession).
 */
export function useChatRoom(roomId: string | null, sessionId: string): UseChatRoom {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Evita actualizar estado tras el desmontaje (cargas asíncronas en vuelo).
  const mountedRef = useRef<boolean>(true);

  // ----- Carga inicial + suscripción Realtime -----
  useEffect(() => {
    mountedRef.current = true;

    if (!roomId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // 1) Historial inicial.
    chatService
      .getMessages(roomId, sessionId)
      .then((history) => {
        if (mountedRef.current) setMessages(history);
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error("Error al cargar mensajes"));
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    // 2) Canal privado por sala: tópico exacto `room:<roomId>`.
    const channel: RealtimeChannel = supabase
      .channel(`room:${roomId}`, { config: { private: true } })
      .on(
        "broadcast",
        { event: "new_message" },
        (msg: { payload: BroadcastNewMessage }) => {
          if (!mountedRef.current) return;
          setMessages((prev) => mergeMessage(prev, fromBroadcast(msg.payload)));
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" && mountedRef.current) {
          setError(new Error("No se pudo conectar al canal de chat en tiempo real."));
        }
      });

    // 3) Limpieza: desuscribir y liberar el canal al desmontar o cambiar de sala.
    return () => {
      mountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, sessionId]);

  // ----- Envío de mensajes -----
  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!roomId) throw new Error("No hay una sala activa.");
      try {
        // El backend inserta y dispara el broadcast; mergeMessage evita duplicar.
        await chatService.sendMessage(roomId, sessionId, text);
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error("Error al enviar el mensaje");
        if (mountedRef.current) setError(e);
        throw e;
      }
    },
    [roomId, sessionId],
  );

  return { messages, loading, error, sendMessage };
}
