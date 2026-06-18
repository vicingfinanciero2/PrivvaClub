// =====================================================================================
//  PrivvaClub — Gestor de identidad fantasma (cliente anónimo)
//
//  El cliente (demandante) no se registra. Su única credencial es un `client_session_id`
//  aleatorio guardado en localStorage, que actúa como BEARER TOKEN de sus salas de chat.
//  Este módulo garantiza que ese id exista y esté disponible de inmediato para las RPCs
//  del chat anónimo (fn_get_or_create_chat_room, fn_send_client_message, ...).
//
//  Expone:
//    - getOrCreateAnonymousSessionId():  helper imperativo (usable fuera de React).
//    - clearAnonymousSession():          olvido total (privacidad / "empezar de cero").
//    - useAnonymousSession():            hook de React con el id reactivo + reset().
// =====================================================================================

import { useCallback, useEffect, useState } from "react";

/** Clave de almacenamiento. Versionada por si cambia el formato a futuro. */
export const ANON_SESSION_KEY = "privva.client_session_id.v1";

/** ¿Estamos en un entorno con localStorage disponible? (SSR-safe). */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Genera un UUID v4. Usa crypto.randomUUID() (requiere contexto seguro: https/localhost)
 * y cae a un fallback basado en getRandomValues si no está disponible.
 */
function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4 con getRandomValues.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Devuelve el session_id persistido o crea uno nuevo y lo guarda.
 * Imperativo: útil en capas de servicio que no son componentes de React.
 * En SSR (sin window) devuelve un id efímero que el cliente reconciliará al montar.
 */
export function getOrCreateAnonymousSessionId(): string {
  if (!isBrowser()) {
    return generateSessionId();
  }
  let id = window.localStorage.getItem(ANON_SESSION_KEY);
  if (!id) {
    id = generateSessionId();
    window.localStorage.setItem(ANON_SESSION_KEY, id);
  }
  return id;
}

/** Borra la identidad fantasma actual (el próximo acceso generará una nueva). */
export function clearAnonymousSession(): void {
  if (isBrowser()) {
    window.localStorage.removeItem(ANON_SESSION_KEY);
  }
}

export interface UseAnonymousSession {
  /** Id de sesión anónima, disponible de inmediato en el cliente. */
  sessionId: string;
  /** Descarta la identidad actual y genera otra. Devuelve el nuevo id. */
  reset: () => string;
}

/**
 * Hook de React: garantiza un client_session_id estable durante la vida del dispositivo.
 *
 *   const { sessionId, reset } = useAnonymousSession();
 *   await supabase.rpc("fn_get_or_create_chat_room", { p_ad_id, p_session_id: sessionId });
 */
export function useAnonymousSession(): UseAnonymousSession {
  // Inicialización perezosa: en el cliente queda disponible en el primer render.
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateAnonymousSessionId());

  // Reconciliación: persiste el id si venía de un render SSR efímero, y sincroniza
  // si otra pestaña lo cambió antes del montaje.
  useEffect(() => {
    if (!isBrowser()) return;
    const stored = window.localStorage.getItem(ANON_SESSION_KEY);
    if (!stored) {
      window.localStorage.setItem(ANON_SESSION_KEY, sessionId);
    } else if (stored !== sessionId) {
      setSessionId(stored);
    }
  }, [sessionId]);

  // Sincronización entre pestañas: si se limpia/cambia en otra, reflejarlo aquí.
  useEffect(() => {
    if (!isBrowser()) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ANON_SESSION_KEY) return;
      setSessionId(e.newValue ?? getOrCreateAnonymousSessionId());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const reset = useCallback((): string => {
    const next = generateSessionId();
    if (isBrowser()) {
      window.localStorage.setItem(ANON_SESSION_KEY, next);
    }
    setSessionId(next);
    return next;
  }, []);

  return { sessionId, reset };
}
