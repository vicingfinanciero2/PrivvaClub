// =====================================================================================
//  PrivvaClub — Edge Function: payment-webhook
//
//  Recibe el webhook de la pasarela de pagos, valida su firma HMAC-SHA256 y, si es
//  legítima, acredita los créditos invocando la RPC `fn_deposit_credits_by_admin`
//  (migración 0003) con la SERVICE_ROLE_KEY — único rol autorizado a ejecutarla.
//
//  La RPC es idempotente por `transaction_id`, así que los reintentos del webhook
//  son seguros (no acreditan dos veces).
//
//  Variables de entorno requeridas (supabase secrets set ...):
//    - WEBHOOK_SECRET             : secreto compartido con la pasarela (firma HMAC).
//    - SUPABASE_URL               : inyectada automáticamente en el deploy.
//    - SUPABASE_SERVICE_ROLE_KEY  : inyectada automáticamente en el deploy.
//
//  Deploy:  supabase functions deploy payment-webhook --no-verify-jwt
//  (--no-verify-jwt porque la autenticación la da la firma HMAC, no un JWT de Supabase.)
// =====================================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ------------------------------------------------------------------------------------
// Tipos
// ------------------------------------------------------------------------------------
interface WebhookPayload {
  profile_id: string;
  amount: number;
  transaction_id: string;
}

interface DepositSuccess {
  success: true;
  transaction_id: string;
  new_balance: number;
}

// Nombre del header donde la pasarela envía la firma. Ajustar al proveedor real.
const SIGNATURE_HEADER = "x-webhook-signature";

// ------------------------------------------------------------------------------------
// Utilidades de respuesta
// ------------------------------------------------------------------------------------
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ------------------------------------------------------------------------------------
// Verificación de firma HMAC-SHA256 (Web Crypto, nativo en Deno)
// ------------------------------------------------------------------------------------
function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparación en tiempo constante para evitar ataques de temporización (timing attacks).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function isSignatureValid(
  rawBody: string,
  receivedSignature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const macBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = hexEncode(macBuffer);

  // Algunos proveedores prefijan la firma (p. ej. "sha256="); se normaliza.
  const normalized = receivedSignature.replace(/^sha256=/i, "").trim().toLowerCase();

  return timingSafeEqual(expected, normalized);
}

// ------------------------------------------------------------------------------------
// Validación del payload
// ------------------------------------------------------------------------------------
function parsePayload(raw: string): WebhookPayload {
  const data = JSON.parse(raw) as Partial<WebhookPayload>;

  if (typeof data.profile_id !== "string" || data.profile_id.length === 0) {
    throw new Error("Campo 'profile_id' ausente o inválido.");
  }
  if (typeof data.amount !== "number" || !Number.isInteger(data.amount) || data.amount <= 0) {
    throw new Error("Campo 'amount' debe ser un entero positivo.");
  }
  if (typeof data.transaction_id !== "string" || data.transaction_id.length === 0) {
    throw new Error("Campo 'transaction_id' ausente o inválido.");
  }

  return {
    profile_id: data.profile_id,
    amount: data.amount,
    transaction_id: data.transaction_id,
  };
}

// ------------------------------------------------------------------------------------
// Handler principal
// ------------------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  // 1) Solo se acepta POST.
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  // Variables de entorno obligatorias.
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Faltan variables de entorno requeridas.");
    return jsonResponse({ error: "Configuración del servidor incompleta." }, 500);
  }

  try {
    // 2) Cuerpo crudo + firma. El raw body es indispensable para validar el HMAC.
    const rawBody = await req.text();
    const signature = req.headers.get(SIGNATURE_HEADER);

    if (!signature) {
      return jsonResponse({ error: "Falta la firma del webhook." }, 401);
    }

    // 3) Validación criptográfica. Si no coincide, se rechaza de inmediato.
    const valid = await isSignatureValid(rawBody, signature, webhookSecret);
    if (!valid) {
      console.warn("Firma de webhook inválida; petición rechazada.");
      return jsonResponse({ error: "Firma inválida." }, 403);
    }

    // 4) Parseo y validación del payload ya autenticado.
    let payload: WebhookPayload;
    try {
      payload = parsePayload(rawBody);
    } catch (parseErr) {
      const message = parseErr instanceof Error ? parseErr.message : "Payload inválido.";
      return jsonResponse({ error: message }, 422);
    }

    // 5) Cliente interno con la SERVICE_ROLE_KEY (la RPC tiene execute revocado al resto).
    const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 6) Acreditación idempotente vía RPC.
    const { data, error } = await supabase.rpc("fn_deposit_credits_by_admin", {
      p_profile_id: payload.profile_id,
      p_amount: payload.amount,
      p_transaction_id: payload.transaction_id,
    });

    if (error) {
      console.error("Error en fn_deposit_credits_by_admin:", error);
      return jsonResponse({ error: "No se pudo acreditar el depósito." }, 502);
    }

    // 7) Éxito: la RPC devuelve el nuevo saldo (entero).
    const response: DepositSuccess = {
      success: true,
      transaction_id: payload.transaction_id,
      new_balance: data as number,
    };
    return jsonResponse(response, 200);
  } catch (err) {
    console.error("Error inesperado en payment-webhook:", err);
    return jsonResponse({ error: "Error interno del servidor." }, 500);
  }
});
