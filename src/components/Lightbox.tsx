// =====================================================================================
//  PrivvaClub — Lightbox (visor de imágenes a pantalla completa, Onyx Dark)
//
//  Fondo negro difuminado, imagen contenida (sin recorte), navegación por swipe nativo
//  (scroll-snap) + flechas + teclado (← → Esc). Click en el fondo o ✕ para cerrar.
// =====================================================================================

import { useEffect, useRef, useState } from "react";

interface LightboxProps {
  images: string[];
  startIndex: number;
  alt: string;
  onClose: () => void;
}

export default function Lightbox({ images, startIndex, alt, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const trackRef = useRef<HTMLDivElement>(null);

  // Posiciona el visor en la imagen pulsada (sin animación) al montar.
  useEffect(() => {
    const t = trackRef.current;
    if (t) t.scrollLeft = t.clientWidth * startIndex;
  }, [startIndex]);

  function goTo(target: number) {
    const t = trackRef.current;
    if (!t) return;
    const clamped = Math.max(0, Math.min(target, images.length - 1));
    t.scrollTo({ left: t.clientWidth * clamped, behavior: "smooth" });
    setIndex(clamped);
  }

  function handleScroll() {
    const t = trackRef.current;
    if (!t) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (i !== index) setIndex(i);
  }

  // Navegación por teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goTo(index - 1);
      else if (e.key === "ArrowRight") goTo(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length]);

  const multiple = images.length > 1;

  return (
    <div className="lightbox-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      {multiple && (
        <div className="lightbox-count">
          {index + 1}/{images.length}
        </div>
      )}

      <div
        className="lightbox-track"
        ref={trackRef}
        onScroll={handleScroll}
        onClick={(e) => e.stopPropagation()}
      >
        {images.map((src, i) => (
          <div className="lightbox-slide" key={`${src}-${i}`}>
            <img src={src} alt={`${alt} — ${i + 1}/${images.length}`} />
          </div>
        ))}
      </div>

      {multiple && (
        <>
          <button
            className="lightbox-arrow left"
            onClick={(e) => {
              e.stopPropagation();
              goTo(index - 1);
            }}
            disabled={index === 0}
            aria-label="Imagen anterior"
          >
            ‹
          </button>
          <button
            className="lightbox-arrow right"
            onClick={(e) => {
              e.stopPropagation();
              goTo(index + 1);
            }}
            disabled={index === images.length - 1}
            aria-label="Imagen siguiente"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
