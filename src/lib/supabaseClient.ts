// =====================================================================================
//  PrivvaClub — Cliente de Supabase (tipado con el esquema de la base de datos)
//
//  Stack asumido: Vite + React. Variables de entorno (archivo .env, prefijo VITE_):
//      VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//      VITE_SUPABASE_ANON_KEY=<anon-public-key>
//
//  NOTA Next.js: reemplazar `import.meta.env.VITE_*` por
//      `process.env.NEXT_PUBLIC_SUPABASE_URL` / `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`.
//
//  IMPORTANTE: aquí solo se usa la ANON key (pública). La service_role key NUNCA debe
//  vivir en el frontend; las operaciones privilegiadas viven en Edge Functions.
// =====================================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

// Tipado de las variables de entorno de Vite.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

const supabaseUrl = (import.meta as unknown as ImportMeta).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as unknown as ImportMeta).env.VITE_SUPABASE_ANON_KEY;

// Falla rápido y claro si falta configuración (evita errores opacos en runtime).
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[supabaseClient] Faltan variables de entorno: define VITE_SUPABASE_URL y " +
      "VITE_SUPABASE_ANON_KEY en tu archivo .env.",
  );
}

/**
 * Cliente único y tipado de Supabase para toda la PWA.
 * El genérico <Database> habilita autocompletado en `.from(...)`, `.rpc(...)`, etc.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true, // sesión del anunciante (authenticated)
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  },
);
