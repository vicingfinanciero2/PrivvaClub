// =====================================================================================
//  PrivvaClub — Panel de verificación (moderación)
//
//  Lista los anuncios para revisión, muestra sus fotos (carrusel), el anunciante y la
//  ciudad, y permite aprobar/retirar el sello de estudio vía fn_verify_ad_by_admin.
//  El cambio se refleja al instante en el panel (y en el feed, por la RLS pública).
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { adminService, type AdminAdItem } from "../services/adminService";
import ImageCarousel from "./ImageCarousel";

type Filter = "pending" | "all";

function isVerified(ad: AdminAdItem): boolean {
  return ad.ads_verification?.is_verified_by_studio === true;
}

export default function AdminVerificationPanel() {
  const [ads, setAds] = useState<AdminAdItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.getReviewQueue();
      if (mountedRef.current) setAds(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la cola");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function act(adId: string, approve: boolean) {
    setBusyId(adId);
    setError(null);
    try {
      const result = await adminService.verifyAd(adId, approve);
      // Refleja el nuevo estado de verificación en memoria.
      setAds((prev) =>
        prev.map((a) =>
          a.id === adId
            ? {
                ...a,
                ads_verification: {
                  is_verified_by_studio: result,
                  verified_at: result ? new Date().toISOString() : null,
                },
              }
            : a,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Acción fallida");
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  const visible = filter === "pending" ? ads.filter((a) => !isVerified(a)) : ads;

  return (
    <>
      <div className="account-head">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Verificación ({visible.length})
        </div>
        <div className="admin-filters">
          <button
            className={`admin-chip${filter === "pending" ? " active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            Pendientes
          </button>
          <button
            className={`admin-chip${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Todos
          </button>
        </div>
      </div>

      {loading && <div className="state">Cargando cola de revisión…</div>}
      {error && <div className="state error">{error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div className="state">No hay anuncios {filter === "pending" ? "pendientes" : ""}.</div>
      )}

      {visible.map((ad) => {
        const verified = isVerified(ad);
        return (
          <div key={ad.id} className="card admin-card">
            <div className="admin-media">
              <ImageCarousel images={ad.image_urls} alt={ad.title} />
              {verified && <span className="badge-verified ad-card-badge">✓ Verificado</span>}
            </div>

            <div className="admin-body">
              <div className="card-title">
                {ad.title}{" "}
                <span className={`status-pill status-ad-${ad.status}`}>{ad.status}</span>
              </div>
              <div className="muted">
                @{ad.profiles?.username ?? "—"} · {ad.cities?.name ?? "—"}
                {ad.zone_neighborhood ? ` · ${ad.zone_neighborhood}` : ""}
                {ad.age ? ` · ${ad.age} años` : ""}
              </div>
              {ad.price != null && (
                <div className="price">${ad.price.toLocaleString("es-CO")}</div>
              )}

              <div className="admin-actions">
                {!verified ? (
                  <button
                    className="btn-action btn-publish"
                    disabled={busyId === ad.id}
                    onClick={() => void act(ad.id, true)}
                  >
                    {busyId === ad.id ? "…" : "✓ Verificar"}
                  </button>
                ) : (
                  <button
                    className="btn-action btn-revoke"
                    disabled={busyId === ad.id}
                    onClick={() => void act(ad.id, false)}
                  >
                    {busyId === ad.id ? "…" : "Quitar sello"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
