// =====================================================================================
//  PrivvaClub — Shell de la aplicación (móvil)
//
//  Navbar (logo + selector de ciudad) · contenido dinámico · bottom navigation.
//  Cada pestaña consume un hook de datos para verificar que la "tubería" hacia
//  Supabase está conectada (Feed, Chats, Mi Cuenta).
// =====================================================================================

import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { useAnonymousSession } from "./hooks/useAnonymousSession";
import { useAdsFeed } from "./hooks/useAdsFeed";
import AdCard from "./components/AdCard";
import ChatWindow from "./components/ChatWindow";
import MyAccount from "./pages/MyAccount";
import AdminVerificationPanel from "./components/AdminVerificationPanel";
import type { AdFeedItem } from "./services/adsService";

// Catálogo fijo de ciudades (coincide con la tabla `cities` del backend).
const CITIES: ReadonlyArray<{ name: string; slug: string }> = [
  { name: "Bogotá", slug: "bogota" },
  { name: "Medellín", slug: "medellin" },
  { name: "Cali", slug: "cali" },
  { name: "Barranquilla", slug: "barranquilla" },
  { name: "Bucaramanga", slug: "bucaramanga" },
  { name: "Cartagena", slug: "cartagena" },
  { name: "Pereira", slug: "pereira" },
];

type Tab = "feed" | "chats" | "account" | "admin";

export default function App() {
  const [tab, setTab] = useState<Tab>("feed");
  const [citySlug, setCitySlug] = useState<string>(CITIES[0].slug);

  // Identidad fantasma del cliente (siempre disponible).
  const { sessionId } = useAnonymousSession();

  // Sesión del anunciante (si la hay) + bandera de admin (app_metadata.role).
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setIsAdmin(data.user?.app_metadata?.role === "admin");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setIsAdmin(session?.user?.app_metadata?.role === "admin");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Si deja de ser admin (logout) y estaba en la pestaña admin, vuelve al feed.
  useEffect(() => {
    if (tab === "admin" && !isAdmin) setTab("feed");
  }, [tab, isAdmin]);

  return (
    <div className="app-shell">
      <header className="navbar">
        <div className="logo">
          Privva<span>Club</span>
        </div>
        <select
          className="city-select"
          value={citySlug}
          onChange={(e) => setCitySlug(e.target.value)}
          aria-label="Seleccionar ciudad"
        >
          {CITIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </header>

      <main className="content">
        {tab === "feed" && <FeedTab citySlug={citySlug} sessionId={sessionId} />}
        {tab === "chats" && <ChatsTab sessionId={sessionId} />}
        {tab === "account" && <MyAccount userId={userId} />}
        {tab === "admin" && isAdmin && <AdminVerificationPanel />}
      </main>

      <nav className="bottom-nav">
        <TabButton label="Feed" icon="🔥" active={tab === "feed"} onClick={() => setTab("feed")} />
        <TabButton label="Chats" icon="💬" active={tab === "chats"} onClick={() => setTab("chats")} />
        <TabButton
          label="Mi Cuenta"
          icon="👤"
          active={tab === "account"}
          onClick={() => setTab("account")}
        />
        {isAdmin && (
          <TabButton
            label="Admin"
            icon="🛡️"
            active={tab === "admin"}
            onClick={() => setTab("admin")}
          />
        )}
      </nav>
    </div>
  );
}

// -------------------------------------------------------------------------------------
// Bottom navigation button
// -------------------------------------------------------------------------------------
function TabButton(props: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab${props.active ? " active" : ""}`}
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
    >
      <span className="tab-icon">{props.icon}</span>
      {props.label}
    </button>
  );
}

// -------------------------------------------------------------------------------------
// Feed — consume useAdsFeed, renderiza AdCard y abre ChatWindow
// -------------------------------------------------------------------------------------
function FeedTab({ citySlug, sessionId }: { citySlug: string; sessionId: string }) {
  const { ads, loading, error, refresh } = useAdsFeed(citySlug);
  const [openChat, setOpenChat] = useState<{ roomId: string; ad: AdFeedItem } | null>(null);

  if (loading) return <div className="state">Cargando anuncios…</div>;
  if (error) return <div className="state error">{error.message}</div>;

  return (
    <>
      <div className="section-title">
        Feed · {citySlug} ({ads.length})
        <button className="city-select" style={{ marginLeft: 8 }} onClick={() => void refresh()}>
          ↻ Refrescar
        </button>
      </div>

      {ads.length === 0 ? (
        <div className="state">No hay anuncios activos en esta ciudad todavía.</div>
      ) : (
        ads.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            sessionId={sessionId}
            onOpenChat={(roomId, openedAd) => setOpenChat({ roomId, ad: openedAd })}
          />
        ))
      )}

      {openChat && (
        <ChatWindow
          roomId={openChat.roomId}
          sessionId={sessionId}
          title={openChat.ad.title}
          onClose={() => setOpenChat(null)}
        />
      )}
    </>
  );
}

// -------------------------------------------------------------------------------------
// Chats — consume useAnonymousSession (identidad fantasma)
// -------------------------------------------------------------------------------------
function ChatsTab({ sessionId }: { sessionId: string }) {
  return (
    <>
      <div className="section-title">Chats</div>
      <div className="card">
        <div className="card-title">Identidad fantasma activa</div>
        <p className="muted">
          Tu sesión es anónima y efímera. Este identificador vive solo en este dispositivo:
        </p>
        <p className="mono">{sessionId}</p>
      </div>
      <div className="state">
        Abre el chat desde un anuncio del feed para iniciar una conversación anónima.
      </div>
    </>
  );
}
