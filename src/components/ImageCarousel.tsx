// =====================================================================================
//  PrivvaClub — Carrusel de imágenes (Onyx Premium)
//
//  Galería fluida basada en scroll-snap nativo: swipe táctil natural en móvil/PWA,
//  con flechas (desktop), puntos indicadores y contador. Sin dependencias.
// =====================================================================================

import { useRef, useState } from "react";
import Lightbox from "./Lightbox";

interface ImageCarouselProps {
  images: string[];
  alt: string;
}

export default function ImageCarousel({ images, alt }: ImageCarouselProps) {
  const [index, setIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  if (!images || images.length === 0) {
    return <div className="carousel placeholder">Sin foto</div>;
  }

  function goTo(target: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(target, images.length - 1));
    track.scrollTo({ left: track.clientWidth * clamped, behavior: "smooth" });
    setIndex(clamped);
  }

  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== index) setIndex(i);
  }

  const multiple = images.length > 1;

  return (
    <div className="carousel">
      <div className="carousel-track" ref={trackRef} onScroll={handleScroll}>
        {images.map((src, i) => (
          <div className="carousel-slide" key={`${src}-${i}`}>
            <img
              src={src}
              alt={`${alt} — ${i + 1}/${images.length}`}
              loading="lazy"
              onClick={() => setLightboxIndex(i)}
            />
          </div>
        ))}
      </div>

      {multiple && (
        <>
          <button
            className="carousel-arrow left"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Imagen anterior"
          >
            ‹
          </button>
          <button
            className="carousel-arrow right"
            onClick={() => goTo(index + 1)}
            disabled={index === images.length - 1}
            aria-label="Imagen siguiente"
          >
            ›
          </button>

          <div className="carousel-count">
            {index + 1}/{images.length}
          </div>

          <div className="carousel-dots">
            {images.map((_, i) => (
              <button
                key={i}
                className={`carousel-dot${i === index ? " active" : ""}`}
                onClick={() => goTo(i)}
                aria-label={`Ir a la imagen ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          startIndex={lightboxIndex}
          alt={alt}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
