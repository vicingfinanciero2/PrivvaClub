// =====================================================================================
//  PrivvaClub — Hook del monedero / panel del anunciante
//
//  Encapsula el estado privado del anunciante: perfil (saldo + estado de cuenta) e
//  historial de transacciones. refresh() permite refrescar el saldo de inmediato tras
//  una recarga procesada por el webhook de pagos.
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { creditsService } from "../services/creditsService";
import type { CreditTransaction, Profile } from "../types/supabase";

export interface UseAdvertiserProfile {
  profile: Profile | null;
  transactions: CreditTransaction[];
  loading: boolean;
  error: Error | null;
  /** Recarga perfil + historial (p. ej. tras un depósito por webhook). */
  refresh: () => Promise<void>;
}

/**
 * @param userId id del anunciante autenticado (null si aún no hay sesión).
 */
export function useAdvertiserProfile(userId: string | null): UseAdvertiserProfile {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    if (!userId) {
      setProfile(null);
      setTransactions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Perfil e historial en paralelo (ambos protegidos por RLS al dueño).
      const [profileData, txData] = await Promise.all([
        creditsService.getProfile(userId),
        creditsService.getTransactionHistory(userId),
      ]);
      if (mountedRef.current) {
        setProfile(profileData);
        setTransactions(txData);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error("Error al cargar el perfil"));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { profile, transactions, loading, error, refresh: load };
}
