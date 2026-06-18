// =====================================================================================
//  PrivvaClub — Gestión de anuncios del anunciante
//
//  Lista los anuncios propios (draft / active / archived) y permite:
//    - Publicar (fn_publish_ad): 10 créditos, o gratis si hay suscripción premium.
//    - Dar bump (fn_bump_ad):     5 créditos, o gratis si hay suscripción premium.
//  Incluye el alta de nuevos borradores (NewAdForm) en una sección colapsable.
//
//  Tras cada acción exitosa refresca su propia lista y notifica al padre
//  (onCreditsChanged) para que el header de la cuenta actualice saldo/suscripción.
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { adsService } from "../services/adsService";
import NewAdForm from "../components/NewAdForm";
import type { Ad } from "../types/supabase";

interface MyAdsProps {
  userId: string;
  /** Notifica al padre que el saldo/suscripción pudo cambiar (publish/bump). */
  onCreditsChanged: () => void;
}

export default function MyAds({ userId, onCreditsChanged }: MyAdsProps) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Id del anuncio con una acción en curso (para deshabilitar su botón).
  const [busyId, setBusyId] = useState<string | null>(null);
  // Mensaje por anuncio (p. ej. "saldo insuficiente").
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adsService.getMyAds(userId);
      if (mountedRef.current) setAds(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "No se pudieron cargar tus anuncios");
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

  type Action = "publish" | "republish" | "bump" | "archive" | "delete";

  async function runAction(adId: string, action: Action) {
    if (
      action === "delete" &&
      !window.confirm("¿Eliminar este anuncio? Se borrarán también sus chats. No se puede deshacer.")
    ) {
      return;
    }
    setBusyId(adId);
    setRowMsg((m) => ({ ...m, [adId]: "" }));
    try {
      if (action === "publish" || action === "republish") await adsService.publishAd(adId);
      else if (action === "bump") await adsService.bumpAd(adId);
      else if (action === "archive") await adsService.archiveAd(adId);
      else if (action === "delete") await adsService.deleteAd(adId);

      await load(); // refresca la lista (status / eliminación)
      if (action === "publish" || action === "republish" || action === "bump") {
        onCreditsChanged(); // estas mueven el saldo (o lo exoneran si es premium)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Acción fallida";
      setRowMsg((m) => ({ ...m, [adId]: msg }));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  return (
    <>
      <div className="account-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Mis anuncios ({ads.length})
        </div>
        <button className="logout-btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cerrar" : "+ Nuevo"}
        </button>
      </div>

      {/* Alta de borradores (colapsable) */}
      {showForm && (
        <div className="card">
          <NewAdForm
            userId={userId}
            onCreated={() => {
              void load();
              setShowForm(false);
            }}
          />
        </div>
      )}

      {loading && <div className="state">Cargando tus anuncios…</div>}
      {error && <div className="state error">{error}</div>}
      {!loading && !error && ads.length === 0 && (
        <div className="state">Aún no tienes anuncios. Crea el primero con “+ Nuevo”.</div>
      )}

      {ads.map((ad) => (
        <div key={ad.id} className="card myad-row">
          <div className="myad-info">
            <div className="card-title">
              {ad.title}{" "}
              <span className={`status-pill status-ad-${ad.status}`}>{ad.status}</span>
            </div>
            <div className="muted">
              {ad.zone_neighborhood ? `${ad.zone_neighborhood} · ` : ""}
              {ad.price != null ? `$${ad.price.toLocaleString("es-CO")}` : "Sin precio"}
            </div>
            {ad.status === "active" && (
              <div className="muted myad-bumped">
                Posicionado: {new Date(ad.bumped_at).toLocaleString("es-CO")}
              </div>
            )}
          </div>

          <div className="myad-actions">
            {ad.status === "draft" && (
              <button
                className="btn-action btn-publish"
                disabled={busyId === ad.id}
                onClick={() => void runAction(ad.id, "publish")}
              >
                {busyId === ad.id ? "…" : "Publicar (10 cr.)"}
              </button>
            )}
            {ad.status === "active" && (
              <button
                className="btn-action btn-bump"
                disabled={busyId === ad.id}
                onClick={() => void runAction(ad.id, "bump")}
              >
                {busyId === ad.id ? "…" : "Bump (5 cr.)"}
              </button>
            )}
            {ad.status === "archived" && (
              <button
                className="btn-action btn-publish"
                disabled={busyId === ad.id}
                onClick={() => void runAction(ad.id, "republish")}
              >
                {busyId === ad.id ? "…" : "Republicar (10 cr.)"}
              </button>
            )}
            {(ad.status === "draft" || ad.status === "active") && (
              <button
                className="btn-action btn-archive"
                disabled={busyId === ad.id}
                onClick={() => void runAction(ad.id, "archive")}
              >
                Archivar
              </button>
            )}
            <button
              className="btn-action btn-delete"
              disabled={busyId === ad.id}
              onClick={() => void runAction(ad.id, "delete")}
            >
              Eliminar
            </button>
          </div>

          {rowMsg[ad.id] && <div className="myad-msg">{rowMsg[ad.id]}</div>}
        </div>
      ))}
    </>
  );
}
