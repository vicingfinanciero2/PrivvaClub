# PrivvaClub — Backend (Supabase)

Manual de operación del backend: directorio premium de entretenimiento y acompañamiento
para Colombia. Stack: **Supabase** (PostgreSQL + Auth + Storage + Realtime) + frontend **PWA**.

> **Modelo:** clientes (demandantes) gratis, anónimos y sin registro. Anunciantes (ofertantes)
> consumen **créditos internos** para publicar/posicionar. Sin comisión por cita.
> Diferenciador: **chat interno ultra-anónimo** dentro de la PWA (sin WhatsApp).

---

## §1 — Arquitectura de archivos

```
supabase/
├── README.md                              ← este manual
├── seed.sql                               ← datos de prueba (entorno local)
│
├── migrations/
│   ├── 0001_init_schema.sql               ← esquema + RLS + chat anónimo + créditos
│   ├── 0002_storage_policies.sql          ← bucket 'ad-images' + políticas Storage
│   ├── 0003_payment_webhook_rpc.sql       ← recargas de créditos (idempotente)
│   └── 0004_admin_verification_rpc.sql    ← sello de verificación por estudio
│
└── functions/
    └── payment-webhook/
        └── index.ts                       ← Edge Function: webhook de pagos (HMAC)
```

| Archivo | Qué hace |
|---|---|
| **0001_init_schema.sql** | Tipos enum, tablas (`cities`, `profiles`, `ads`, `ads_verification`, `credit_transactions`, `chat_rooms`, `chat_messages`), índices del feed, triggers (`handle_new_user`, `updated_at`, blindaje de saldo), **RLS** completa, **RPCs del chat anónimo**, `fn_bump_ad` / `fn_publish_ad`, **Realtime Broadcast** y la purga `fn_purge_old_anonymous_chats` agendada con `pg_cron`. |
| **0002_storage_policies.sql** | Crea el bucket público `ad-images` y las políticas: lectura pública, escritura solo del dueño en su carpeta `<auth.uid()>/...`. |
| **0003_payment_webhook_rpc.sql** | `fn_deposit_credits_by_admin` (`SECURITY DEFINER`, `FOR UPDATE`, idempotente por `external_ref`). Ejecutable solo por `service_role`. |
| **0004_admin_verification_rpc.sql** | `fn_verify_ad_by_admin`: activa/retira el sello; autorizado por `is_admin()`. |
| **functions/payment-webhook** | Valida la firma HMAC-SHA256 del webhook e invoca `fn_deposit_credits_by_admin` con la `service_role` key. |
| **seed.sql** | 4 usuarios, 5 anuncios (varios estados/ciudades), 2 chats y 1 verificación. Idempotente. |

---

## §2 — Guía de despliegue local

**Requisitos:** [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker.

```bash
# 1) Levantar el stack local (Postgres, Auth, Storage, Realtime, Studio...).
supabase start

# 2) Aplicar migraciones 0001–0004 + correr seed.sql en limpio.
#    Úsalo cada vez que cambies una migración o el seed.
supabase db reset

# 3) Servir las Edge Functions localmente (otra terminal).
supabase functions serve payment-webhook --no-verify-jwt --env-file ./supabase/.env.local
```

### Verificación rápida

```bash
supabase status        # URLs y llaves locales (API, DB, Studio, anon/service_role key)
```

```sql
-- En el SQL Editor de Studio (http://127.0.0.1:54323):
select username, account_status, credit_balance from public.profiles;       -- 4 perfiles
select title, status from public.ads;                                        -- 5 anuncios
select count(*) from public.chat_messages where is_read = false;             -- no leídos

-- Cobro de bump (anunciante con saldo). Devuelve el nuevo bumped_at:
select public.fn_bump_ad('c0000000-0000-0000-0000-000000000001');
```

> **`pg_cron`:** si `supabase db reset` falla al agendar la purga, habilita la extensión en
> *Studio → Database → Extensions* y reaplica.

### Probar el webhook local

```bash
# Genera la firma HMAC del body y envíala en el header:
BODY='{"profile_id":"b0000000-0000-0000-0000-000000000002","amount":100,"transaction_id":"evt_test_001"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "mi_secreto_local" | sed 's/^.* //')

curl -i -X POST http://127.0.0.1:54321/functions/v1/payment-webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: $SIG" \
  -d "$BODY"
# -> 200 { "success": true, "new_balance": 150 }   (reintentar el mismo evt_test_001 NO duplica)
```

`supabase/.env.local` (no commitear):
```
WEBHOOK_SECRET=mi_secreto_local
```

---

## §3 — Secretos y configuración de producción

### Secretos de Edge Functions

```bash
# Secreto compartido con la pasarela para validar la firma del webhook.
supabase secrets set WEBHOOK_SECRET="<secreto_real_de_la_pasarela>"

# Deploy de la función (la autenticación la da el HMAC, no un JWT):
supabase functions deploy payment-webhook --no-verify-jwt
```

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se **inyectan automáticamente** en el deploy;
> no las setees manualmente. Nunca expongas la `service_role` key en el frontend.

### Asignar el rol de administrador

El rol admin vive en `app_metadata.role` del usuario y habilita `is_admin()` (verificación de
anuncios y demás endpoints protegidos). Se asigna desde el servidor con la `service_role` key:

```ts
// Script de servidor (NO frontend):
await supabaseAdmin.auth.admin.updateUserById(userId, {
  app_metadata: { role: "admin" },
});
```

> `app_metadata` solo es escribible con `service_role` — el usuario **no** puede auto-promoverse.
> El cambio aplica en el próximo refresh del JWT.

### Checklist al pasar a la nube

- [ ] `supabase link` al proyecto y `supabase db push` (migraciones 0001–0004).
- [ ] `pg_cron` habilitado en el proyecto (Database → Extensions).
- [ ] `WEBHOOK_SECRET` seteado y `payment-webhook` desplegada.
- [ ] Al menos un usuario con `app_metadata.role = 'admin'`.
- [ ] **No** ejecutar `seed.sql` en producción (es solo para local).
- [ ] Configurar el webhook de la pasarela apuntando a la URL de la función.

---

## §4 — Contrato de integración (Frontend / PWA)

Todas las RPCs se invocan con `supabase.rpc('<nombre>', { ...params })`.

### Chat anónimo (cliente fantasma — rol `anon`)

El cliente genera su `session_id` (`crypto.randomUUID()`) una vez y lo guarda en `localStorage`.
Es su única credencial: trátalo como token. No accede a tablas; **solo** estas RPCs:

| RPC | Parámetros | Devuelve |
|---|---|---|
| `fn_get_or_create_chat_room` | `p_ad_id uuid`, `p_session_id text` | `uuid` (room_id) |
| `fn_send_client_message` | `p_room_id uuid`, `p_session_id text`, `p_text text` | `bigint` (message id) |
| `fn_get_messages` | `p_room_id uuid`, `p_session_id text` | filas de `chat_messages` |
| `fn_mark_read_by_client` | `p_room_id uuid`, `p_session_id text` | `void` |

### Monetización (anunciante — rol `authenticated`)

| RPC | Parámetros | Efecto |
|---|---|---|
| `fn_publish_ad` | `target_ad_id uuid` | Cobra 10 créditos y pone el anuncio en `active`. |
| `fn_bump_ad` | `target_ad_id uuid` | Cobra 5 créditos y actualiza `bumped_at = now()` (sube en el feed). |

> Saldo insuficiente → la RPC lanza excepción (`errcode 'insufficient_resources'`); captúrala en el cliente.

### Administración (rol `authenticated` con `app_metadata.role = 'admin'`)

| RPC | Parámetros | Efecto |
|---|---|---|
| `fn_verify_ad_by_admin` | `p_ad_id uuid`, `p_is_verified boolean` | Activa/retira el sello de estudio. |

> `fn_deposit_credits_by_admin` **no** se llama desde el frontend: solo vía Edge Function con `service_role`.

### Realtime Broadcast (chat en vivo)

Cliente y anunciante se suscriben al **canal privado** por sala. Formato de tópico: **`room:<room_id>`**.

```ts
const channel = supabase
  .channel(`room:${roomId}`, { config: { private: true } })
  .on("broadcast", { event: "new_message" }, ({ payload }) => {
    // payload: { id, room_id, sender_type, message_text, created_at }
    appendMessage(payload);
  })
  .subscribe();
```

> La autorización del canal la imponen las políticas RLS sobre `realtime.messages` (ver 0001 §9):
> el anunciante entra a sus salas; el `anon` entra si la sala existe (el UUID actúa como secreto).
> Cada `INSERT` en `chat_messages` emite el broadcast automáticamente (trigger).

### Feed de anuncios (lectura pública — `anon` + `authenticated`)

```ts
// Solo se leen anuncios activos (RLS); ordenar por posicionamiento.
const { data } = await supabase
  .from("ads")
  .select("*, cities(name, slug), ads_verification(is_verified_by_studio)")
  .eq("status", "active")
  .eq("city_id", cityId)            // opcional: filtro por ciudad
  .order("bumped_at", { ascending: false });
```

### Storage de imágenes

- Bucket público **`ad-images`**. Convención de ruta: **`<auth.uid()>/<ad_id>/<archivo>`**.
- Subida (solo el dueño en su carpeta) y URL pública:

```ts
const path = `${user.id}/${adId}/${crypto.randomUUID()}.jpg`;
await supabase.storage.from("ad-images").upload(path, file);
const { data } = supabase.storage.from("ad-images").getPublicUrl(path);
// guarda data.publicUrl dentro de public.ads.image_urls (text[])
```

---

**Resumen de roles:** `anon` (cliente: lee anuncios activos + chat vía RPC) · `authenticated`
(anunciante: sus datos, sus anuncios, monetización) · `admin` (verificación) · `service_role`
(webhook de pagos, asignación de roles — solo servidor).
