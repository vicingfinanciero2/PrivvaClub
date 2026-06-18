// =====================================================================================
//  PrivvaClub — Servicio de administración / moderación
//
//  Requiere un usuario con app_metadata.role = 'admin' (is_admin() en el backend).
//    - getReviewQueue(): todos los anuncios con su ciudad, verificación y anunciante.
//    - verifyAd(adId, isVerified): invoca la RPC fn_verify_ad_by_admin (gateada server-side).
//  La RLS de 0009 permite al admin leer todos los anuncios y perfiles.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { Ad } from "../types/supabase";

export interface AdminAdItem extends Ad {
  cities: { name: string; slug: string } | null;
  ads_verification: { is_verified_by_studio: boolean; verified_at: string | null } | null;
  profiles: { username: string | null } | null;
}

function svcError(action: string, message?: string): Error {
  return new Error(`[adminService] ${action} falló: ${message ?? "error desconocido"}`);
}

/** Cola de revisión: todos los anuncios con datos para moderar. */
export async function getReviewQueue(): Promise<AdminAdItem[]> {
  const { data, error } = await supabase
    .from("ads")
    .select(
      "*, cities(name, slug), ads_verification(is_verified_by_studio, verified_at), profiles(username)",
    )
    .order("created_at", { ascending: false });

  if (error) throw svcError("getReviewQueue", error.message);
  return (data ?? []) as unknown as AdminAdItem[];
}

/** Aprueba (true) o retira (false) el sello de estudio. Devuelve el estado final. */
export async function verifyAd(adId: string, isVerified: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_verify_ad_by_admin", {
    p_ad_id: adId,
    p_is_verified: isVerified,
  });
  if (error) throw svcError("verifyAd", error.message);
  return data as boolean;
}

export const adminService = {
  getReviewQueue,
  verifyAd,
};
