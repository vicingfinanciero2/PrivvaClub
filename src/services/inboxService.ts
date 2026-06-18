// =====================================================================================
//  PrivvaClub — Servicio de bandeja del anunciante (lado authenticated)
//
//  El anunciante tiene acceso directo (vía RLS) a sus chat_rooms y chat_messages, así
//  que aquí se usa PostgREST sin RPCs:
//    - getInbox(userId):        salas + último mensaje + no leídos + título del anuncio.
//    - getRoomMessages(roomId):  historial de una sala.
//    - sendAdvertiserMessage:    inserta un mensaje como 'advertiser' (dispara el broadcast
//                                al cliente vía el trigger del backend).
//    - markRoomRead(roomId):     marca como leídos los mensajes del cliente.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { ChatMessage, SenderType } from "../types/supabase";

export interface InboxRoom {
  roomId: string;
  adId: string;
  adTitle: string;
  clientSessionId: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSender: SenderType | null;
  unreadCount: number;
  updatedAt: string;
}

function svcError(action: string, message?: string): Error {
  return new Error(`[inboxService] ${action} falló: ${message ?? "error desconocido"}`);
}

/** Forma cruda de la fila de chat_rooms con el anuncio embebido. */
interface RoomRow {
  id: string;
  ad_id: string;
  client_session_id: string;
  updated_at: string;
  ads: { title: string } | { title: string }[] | null;
}

function adTitleOf(row: RoomRow): string {
  const a = row.ads;
  if (!a) return "Anuncio";
  return Array.isArray(a) ? a[0]?.title ?? "Anuncio" : a.title;
}

/**
 * Bandeja completa del anunciante: una pasada por salas y otra por sus mensajes,
 * reduciendo en cliente el último mensaje y el conteo de no leídos por sala.
 */
export async function getInbox(userId: string): Promise<InboxRoom[]> {
  const { data: rooms, error } = await supabase
    .from("chat_rooms")
    .select("id, ad_id, client_session_id, updated_at, ads(title)")
    .eq("advertiser_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw svcError("getInbox", error.message);
  const roomRows = (rooms ?? []) as unknown as RoomRow[];
  if (roomRows.length === 0) return [];

  const roomIds = roomRows.map((r) => r.id);
  const { data: msgs, error: mErr } = await supabase
    .from("chat_messages")
    .select("room_id, message_text, sender_type, is_read, created_at")
    .in("room_id", roomIds)
    .order("created_at", { ascending: true });

  if (mErr) throw svcError("getInbox", mErr.message);

  const last = new Map<string, { text: string; sender: SenderType; at: string }>();
  const unread = new Map<string, number>();
  for (const m of msgs ?? []) {
    last.set(m.room_id, { text: m.message_text, sender: m.sender_type, at: m.created_at });
    if (m.sender_type === "client" && !m.is_read) {
      unread.set(m.room_id, (unread.get(m.room_id) ?? 0) + 1);
    }
  }

  return roomRows.map((r) => ({
    roomId: r.id,
    adId: r.ad_id,
    adTitle: adTitleOf(r),
    clientSessionId: r.client_session_id,
    updatedAt: r.updated_at,
    lastMessage: last.get(r.id)?.text ?? null,
    lastMessageAt: last.get(r.id)?.at ?? null,
    lastSender: last.get(r.id)?.sender ?? null,
    unreadCount: unread.get(r.id) ?? 0,
  }));
}

/** Historial de una sala (RLS restringe a salas del anunciante). */
export async function getRoomMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw svcError("getRoomMessages", error.message);
  return data ?? [];
}

/** Envía un mensaje como anunciante (RLS exige sender_type='advertiser' en sala propia). */
export async function sendAdvertiserMessage(roomId: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) throw svcError("sendAdvertiserMessage", "mensaje vacío");
  const { error } = await supabase
    .from("chat_messages")
    .insert({ room_id: roomId, sender_type: "advertiser", message_text: clean });
  if (error) throw svcError("sendAdvertiserMessage", error.message);
}

/** Marca como leídos los mensajes del cliente en una sala. */
export async function markRoomRead(roomId: string): Promise<void> {
  const { error } = await supabase
    .from("chat_messages")
    .update({ is_read: true })
    .eq("room_id", roomId)
    .eq("sender_type", "client")
    .eq("is_read", false);
  if (error) throw svcError("markRoomRead", error.message);
}

export const inboxService = {
  getInbox,
  getRoomMessages,
  sendAdvertiserMessage,
  markRoomRead,
};
