// =====================================================================================
//  PrivvaClub — Tarjeta de anuncio (feed)
//
//  Muestra el anuncio (foto, título, zona, edad, precio) con el sello dorado
//  "Verificado" si is_verified_by_studio. El botón "Chatear en Anon" crea/abre la
//  sala anónima vía chatService y notifica al padre con el roomId.
// =====================================================================================

import { useState } from "react";
import { chatService } from "../services/chatService";
import ImageCarousel from "./ImageCarousel";
import type { AdFeedItem } from "../services/adsService";

interface AdCardProps {
  ad: AdFeedItem;
  sessionId: string;
  /** Se invoca con el roomId tras crear/obtener la sala. */
  onOpenChat: (roomId: string, ad: AdFeedItem) => void;
}

export default function AdCard({ ad, sessionId, onOpenChat }: AdCardProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verified = ad.ads_verification?.is_verified_by_studio === true;

  async function handleChat() {
    setOpening(true);
    setError(null);
    try {
      const roomId = await chatService.getOrCreateRoom(ad.id, sessionId);
      onOpenChat(roomId, ad);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el chat");
    } finally {
      setOpening(false);
    }
  }

  return (
    <article className="ad-card">
      <div className="ad-card-media">
        <ImageCarousel images={ad.image_urls} alt={ad.title} />
        {verified && <span className="badge-verified ad-card-badge">✓ Verificado</span>}
      </div>

      <div className="ad-card-body">
        <h3 className="ad-card-title">{ad.title}</h3>

        <div className="muted ad-card-meta">
          {ad.cities?.name}
          {ad.zone_neighborhood ? ` · ${ad.zone_neighborhood}` : ""}
          {ad.age ? ` · ${ad.age} años` : ""}
        </div>

        {ad.price != null && (
          <div className="price ad-card-price">${ad.price.toLocaleString("es-CO")}</div>
        )}

        {ad.description && <p className="muted ad-card-desc">{ad.description}</p>}

        <button className="btn-chat" onClick={handleChat} disabled={opening}>
          {opening ? "Abriendo…" : "💬 Chatear en Anon"}
        </button>

        {error && <div className="ad-card-error">{error}</div>}
      </div>
    </article>
  );
}
