// =====================================================================================
//  PrivvaClub — Hook reactivo del feed de anuncios
//
//  Para una ciudad (citySlug): carga los anuncios activos ordenados por bumped_at,
//  gestiona loading/error y expone refresh() para recarga manual (pull-to-refresh).
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { adsService, type AdFeedItem } from "../services/adsService";

export interface UseAdsFeed {
  ads: AdFeedItem[];
  loading: boolean;
  error: Error | null;
  /** Recarga manual del feed (pull-to-refresh). */
  refresh: () => Promise<void>;
}

/**
 * @param citySlug slug de la ciudad (null/"" para no cargar todavía).
 */
export function useAdsFeed(citySlug: string | null): UseAdsFeed {
  const [ads, setAds] = useState<AdFeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    if (!citySlug) {
      setAds([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await adsService.getActiveAdsByCity(citySlug);
      if (mountedRef.current) setAds(data);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error("Error al cargar el feed"));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [citySlug]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { ads, loading, error, refresh: load };
}
