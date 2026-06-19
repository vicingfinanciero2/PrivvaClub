// =====================================================================================
//  PrivvaClub — Servicio de verificación de creador (KYC)
//
//  Datos sensibles -> bucket PRIVADO `creator-kyc`. Se guardan PATHS (no URLs públicas);
//  para mostrarlos se firma una URL temporal. El estado solo avanza vía RPC.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { CreatorApplication, CreatorAppStatus } from "../types/supabase";

const KYC_BUCKET = "creator-kyc";

function svcError(action: string, message?: string): Error {
  return new Error(`[creatorService] ${action} falló: ${message ?? "error desconocido"}`);
}

/** Solicitud actual del usuario (o null si aún no inició el proceso). */
export async function getMyApplication(userId: string): Promise<CreatorApplication | null> {
  const { data, error } = await supabase
    .from("creator_applications")
    .select("*")
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) throw svcError("getMyApplication", error.message);
  return data;
}

/** Tipo de archivo KYC (define el nombre en el bucket). */
export type KycKind = "doc-front" | "doc-back" | "selfie" | "selfie-doc";

/** Sube un archivo/blob KYC al bucket privado y devuelve su PATH (no URL). */
export async function uploadKyc(
  userId: string,
  kind: KycKind,
  file: Blob,
  ext = "jpg",
): Promise<string> {
  const path = `${userId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(KYC_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
  if (error) throw svcError("uploadKyc", error.message);
  return path;
}

/** URL firmada temporal para previsualizar un archivo privado. */
export async function signedUrl(path: string, expiresInSec = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from(KYC_BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error) throw svcError("signedUrl", error.message);
  return data.signedUrl;
}

/** Crea o actualiza (upsert) el borrador de la solicitud. NO toca el estado. */
export async function saveApplication(
  userId: string,
  patch: Partial<CreatorApplication>,
): Promise<CreatorApplication> {
  const { data, error } = await supabase
    .from("creator_applications")
    .upsert({ profile_id: userId, ...patch }, { onConflict: "profile_id" })
    .select("*")
    .single();
  if (error) throw svcError("saveApplication", error.message);
  return data;
}

/** Envía la solicitud a revisión (valida completitud en el servidor). */
export async function submitApplication(): Promise<CreatorAppStatus> {
  const { data, error } = await supabase.rpc("fn_submit_creator_application");
  if (error) throw svcError("submitApplication", error.message);
  return data as CreatorAppStatus;
}

export const creatorService = {
  getMyApplication,
  uploadKyc,
  signedUrl,
  saveApplication,
  submitApplication,
};
