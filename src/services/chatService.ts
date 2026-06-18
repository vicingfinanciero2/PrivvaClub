// =====================================================================================
//  PrivvaClub — Servicio del chat anónimo
//
//  Funciones puras que envuelven las RPCs de chat (migración 0001 §7). El cliente
//  fantasma NO accede a tablas: toda la operativa pasa por estas RPCs, que validan
//  el `sessionId` contra la sala en el servidor.
//
//  Convención: cada función lanza un Error legible si la RPC falla; el caller
//  (hook/UI) decide cómo mostrarlo.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { ChatMessage } from "../types/supabase";

/** Normaliza el error de una RPC a un Error con mensaje claro. */
function rpcError(action: string, message?: string): Error {
  return new Error(`[chatService] ${action} falló: ${message ?? "error desconocido"}`);
}

/**
 * Obtiene (o crea idempotentemente) la sala para (anuncio, sesión).
 * @returns roomId
 */
export async function getOrCreateRoom(adId: string, sessionId: string): Promise<string> {
  const { data, error } = await supabase.rpc("fn_get_or_create_chat_room", {
    p_ad_id: adId,
    p_session_id: sessionId,
  });
  if (error) throw rpcError("getOrCreateRoom", error.message);
  if (!data) throw rpcError("getOrCreateRoom", "no se devolvió roomId");
  return data;
}

/**
 * Envía un mensaje del cliente. La RPC valida sesión↔sala antes de insertar.
 * @returns id del mensaje creado
 */
export async function sendMessage(
  roomId: string,
  sessionId: string,
  text: string,
): Promise<number> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw rpcError("sendMessage", "el mensaje está vacío");
  }
  const { data, error } = await supabase.rpc("fn_send_client_message", {
    p_room_id: roomId,
    p_session_id: sessionId,
    p_text: trimmed,
  });
  if (error) throw rpcError("sendMessage", error.message);
  return data as number;
}

/**
 * Carga el historial completo de la sala, validando la sesión del cliente.
 */
export async function getMessages(
  roomId: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc("fn_get_messages", {
    p_room_id: roomId,
    p_session_id: sessionId,
  });
  if (error) throw rpcError("getMessages", error.message);
  return (data ?? []) as ChatMessage[];
}

/**
 * Marca como leídos los mensajes del anunciante que el cliente ya vio.
 */
export async function markAsRead(roomId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("fn_mark_read_by_client", {
    p_room_id: roomId,
    p_session_id: sessionId,
  });
  if (error) throw rpcError("markAsRead", error.message);
}

export const chatService = {
  getOrCreateRoom,
  sendMessage,
  getMessages,
  markAsRead,
};
