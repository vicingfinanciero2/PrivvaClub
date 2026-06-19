// =====================================================================================
//  PrivvaClub — Servicio de perfil del ofertante
//
//  Edición de campos cosméticos (username, bio, avatar) y subida de la foto de perfil.
//  El avatar reutiliza el bucket ad-images con ruta <uid>/avatar/... (RLS de carpeta).
//  El guard de 0011 impide tocar saldo/suscripción/estado por esta vía.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../types/supabase";

const AD_IMAGES_BUCKET = "ad-images";

function svcError(action: string, message?: string): Error {
  return new Error(`[profileService] ${action} falló: ${message ?? "error desconocido"}`);
}

export interface ProfilePatch {
  username?: string;
  bio?: string | null;
  avatar_url?: string | null;
}

/** Actualiza campos cosméticos del perfil. RLS: solo el dueño (auth.uid() = id). */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw svcError("updateProfile", error.message);
  return data;
}

/** Sube la foto de perfil a ad-images/<uid>/avatar/... y devuelve su URL pública. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/avatar/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(AD_IMAGES_BUCKET)
    .upload(path, file, { upsert: false, cacheControl: "3600", contentType: file.type || undefined });
  if (error) throw svcError("uploadAvatar", error.message);

  const { data } = supabase.storage.from(AD_IMAGES_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw svcError("uploadAvatar", "no se pudo resolver la URL pública");
  return data.publicUrl;
}

export const profileService = {
  updateProfile,
  uploadAvatar,
};
