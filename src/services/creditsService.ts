// =====================================================================================
//  PrivvaClub — Servicio de créditos y perfil (datos privados del anunciante)
//
//  Lee el perfil y el historial financiero del anunciante autenticado. La seguridad
//  la imponen las políticas RLS del backend (0001):
//    - profiles:            SELECT solo del dueño (auth.uid() = id).
//    - credit_transactions: SELECT solo del dueño (profile_id = auth.uid()) o admin.
//  Por eso, aunque se pase un userId, la base de datos NUNCA devolverá datos ajenos.
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { CreditTransaction, Profile } from "../types/supabase";

function serviceError(action: string, message?: string): Error {
  return new Error(`[creditsService] ${action} falló: ${message ?? "error desconocido"}`);
}

/**
 * Obtiene el perfil del anunciante (estado de cuenta y saldo de créditos).
 * RLS garantiza que solo el dueño puede leerlo.
 */
export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw serviceError("getProfile", error.message);
  if (!data) throw serviceError("getProfile", "perfil no encontrado");
  return data;
}

/**
 * Historial financiero del anunciante (deposit / ad_publish / ad_bump),
 * ordenado del más reciente al más antiguo.
 */
export async function getTransactionHistory(
  userId: string,
): Promise<CreditTransaction[]> {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw serviceError("getTransactionHistory", error.message);
  return data ?? [];
}

export const creditsService = {
  getProfile,
  getTransactionHistory,
};
