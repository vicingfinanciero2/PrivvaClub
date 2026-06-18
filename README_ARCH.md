# PrivvaClub — Arquitectura del Frontend (Manifiesto Ejecutivo)

PWA (Vite + React + TypeScript) sobre Supabase (PostgreSQL + Auth + Storage + Realtime).
Directorio premium de clasificados para adultos en Colombia. Cliente **anónimo y gratuito**;
anunciante **autenticado** que monetiza por **créditos** o **suscripción**.

Principio rector: **la seguridad y la lógica de negocio viven en la base de datos** (RLS +
funciones `SECURITY DEFINER`); el frontend es un consumidor tipado y "tonto" que nunca
es la frontera de confianza.

```
src/
├── lib/supabaseClient.ts        Cliente único tipado <Database> (solo anon key)
├── types/supabase.ts            Tipos del esquema + firmas de RPCs
├── hooks/                       useAnonymousSession · useChatRoom · useAdsFeed · useAdvertiserProfile
├── services/                    chatService · adsService · creditsService · inboxService · adminService
├── components/                  AdCard · ImageCarousel · Lightbox · ChatWindow · AdvertiserInbox/Chat · AuthForm · NewAdForm · AdminVerificationPanel
└── pages/                       MyAccount · MyAds
```

---

## Pilar 1 — Autenticación e inyección de roles (JWT + RLS)

**Dos identidades, dos modelos de confianza:**

| Identidad | Mecanismo | Frontera de seguridad |
|---|---|---|
| Cliente (demandante) | `client_session_id` (UUID en `localStorage`, `useAnonymousSession`) | El UUID es un *bearer token*; validado dentro de las RPCs. |
| Anunciante / Admin | Supabase Auth (email+password) → JWT | RLS por `auth.uid()`; rol por `app_metadata.role`. |

- **Flujo:** `AuthForm` (`signInWithPassword`/`signUp`) → `App` escucha `onAuthStateChange` →
  expone `userId` e `isAdmin` (de `app_metadata.role`). La pestaña **🛡️ Admin** solo se
  renderiza si `isAdmin`, pero **eso es cosmético**: la autorización real es la RLS
  `is_admin()` (lee el JWT) + el gate dentro de `fn_verify_ad_by_admin`. Un cliente que
  forzara la UI no podría escribir nada.
- **Roles asignados server-side:** `app_metadata.role` solo se setea con `service_role`; el
  usuario no puede auto-promoverse.
- **Endurecido por linter (migraciones 0006/0007):** `(select auth.uid())` en políticas
  (initplan), `REVOKE EXECUTE` de funciones internas, `search_path` fijo en `SECURITY DEFINER`.

---

## Pilar 2 — Modelo híbrido de mensajería en tiempo real

Cada lado usa el transporte de Realtime que mejor encaja con su modelo de confianza:

```
                 ┌─────────────────────────────┐
   Cliente anon  │  RPCs SECURITY DEFINER       │  fn_get_or_create_chat_room
   (sin tablas)  │  validan client_session_id   │  fn_send_client_message / fn_get_messages
                 └──────────────┬──────────────┘
                                │ INSERT chat_messages
                                ▼
                     trigger tg_broadcast_message
                    ┌───────────┴───────────────┐
       BROADCAST    │ realtime.send('room:<id>') │   POSTGRES_CHANGES
   (canal privado)  │   (autorizado por RLS en   │   (INSERT en chat_messages,
   ←── Cliente anon │    realtime.messages)      │    acotado por RLS) ──→ Anunciante
                    └────────────────────────────┘
```

- **Cliente anónimo → Broadcast:** `useChatRoom` se suscribe al canal privado
  `room:<roomId>`; el UUID de la sala es el secreto que autoriza (política sobre
  `realtime.messages`). No toca tablas: lee/escribe solo por RPC. El push en vivo llega por
  el evento `new_message` que emite el trigger del backend.
- **Anunciante → Postgres Changes:** como es `authenticated`, `AdvertiserInbox` usa una sola
  suscripción `postgres_changes` sobre `chat_messages`; la **RLS** (`chatmsg_advertiser_select`)
  filtra y solo recibe los mensajes de **sus** salas. La bandeja incrementa el contador de
  no leídos y reordena en vivo. Responder es un `INSERT` directo (RLS `*_advertiser_insert`),
  que a su vez dispara el broadcast hacia el cliente → **bucle bidireccional cerrado**.
- **Por qué híbrido:** `anon` no puede hacer `postgres_changes` con garantías (sin SELECT en
  la tabla); el anunciante sí, y le da una bandeja con un solo socket. Cada quien su carril.
- **Privacidad:** `fn_purge_old_anonymous_chats` (pg_cron) borra salas/mensajes inactivos >48h.

---

## Pilar 3 — Sistema transaccional de créditos y publicación (RPCs)

Ninguna mutación de dinero ocurre en el cliente. Todo pasa por funciones `SECURITY DEFINER`
transaccionales con bloqueo de fila (`FOR UPDATE`):

| Acción (frontend) | RPC | Lógica server-side |
|---|---|---|
| Publicar / Republicar | `fn_publish_ad` | 10 créditos **o gratis si suscripción activa**; pasa a `active`. |
| Bump (posicionar) | `fn_bump_ad` | 5 créditos **o gratis si premium**; actualiza `bumped_at`. |
| Recarga (webhook pago) | `fn_deposit_credits_by_admin` | Idempotente por `external_ref`; solo `service_role`. |
| Activar membresía | `fn_activate_subscription_by_admin` | Idempotente; extiende `subscription_expires_at`. |
| Verificar anuncio | `fn_verify_ad_by_admin` | Gate `is_admin()`; sella `verified_by/at`. |

- **Modelo híbrido agnóstico para el frontend:** la exoneración premium vive en
  `fn_publish_ad`/`fn_bump_ad` (`has_active_subscription`). El mismo botón sirve para ambos
  planes; la UI no decide si cobra — solo invoca y refleja el resultado.
- **Blindaje del saldo:** `credit_balance` tiene `CHECK >= 0` y un trigger que **rechaza
  cualquier UPDATE directo** del saldo desde la API; solo cambia dentro de las RPCs (que
  corren como owner). El libro mayor `credit_transactions` es la fuente de auditoría.
- **Propagación de eventos en UI:** tras publish/bump/republish, `MyAds` recarga su lista y
  emite `onCreditsChanged()` → `MyAccount` ejecuta `refresh()` del `useAdvertiserProfile`, y
  el saldo/suscripción del header se actualiza al instante. Los errores transaccionales
  (p. ej. *saldo insuficiente*, `RAISE EXCEPTION`) se muestran inline sin romper el panel.
- **Storage coherente:** las fotos se suben a `ad-images/<uid>/<adId>/...` (RLS de carpeta);
  el alta crea el `draft` primero para tener el `adId` antes de subir.

---

## Estado del producto

Feed anónimo con carrusel + lightbox · chat efímero bidireccional en vivo · créditos +
suscripción premium · alta/publicación/bump/archivar/eliminar/republicar · bandeja del
anunciante en tiempo real · panel de moderación con sello verificado.

**Migraciones:** `0001`–`0009` (esquema, RLS, chat, créditos, storage, webhook, verificación,
suscripción, hardening, realtime inbox, moderación admin). Ver `supabase/README.md` para
despliegue y contrato de integración.

**Pendiente manual (no SQL):** activar *Leaked Password Protection* en Auth; silenciar en el
dashboard los advisors `SECURITY DEFINER` que son intencionales (RPCs de chat/monetización).
