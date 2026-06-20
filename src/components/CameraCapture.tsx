// =====================================================================================
//  PrivvaClub — Captura de cámara en tiempo real (selfie KYC)
//
//  Pide permiso de cámara (PC o móvil) vía getUserMedia. Si el usuario lo deniega o no
//  hay cámara, ofrece un botón para reintentar el permiso y un fallback de archivo.
//  Tras capturar libera la cámara. "Repetir" reinicia y notifica al padre (onClear).
// =====================================================================================

import { useCallback, useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  facing?: "user" | "environment";
  onCapture: (blob: Blob, previewUrl: string) => void;
  onClear?: () => void;
}

export default function CameraCapture({ facing = "user", onCapture, onClear }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setDenied(false);
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setDenied(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch {
      setDenied(true);
    }
  }, [facing]);

  useEffect(() => {
    void start();
    return () => stop();
  }, [start, stop]);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setShot(url);
        stop(); // liberar la cámara tras capturar
        onCapture(blob, url);
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    setShot(null);
    onClear?.();
    void start();
  }

  function onFile(f: File | null) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setShot(url);
    onCapture(f, url);
  }

  // Foto tomada -> preview + repetir.
  if (shot) {
    return (
      <div className="camera">
        <img className="camera-shot" src={shot} alt="Captura" />
        <button type="button" className="kyc-remove" onClick={retake}>
          ✕ Volver a tomar
        </button>
      </div>
    );
  }

  // Cámara no disponible / permiso denegado -> reintentar + fallback.
  if (denied) {
    return (
      <div className="camera-fallback">
        <p className="muted">
          No pudimos usar la cámara. Da permiso e inténtalo, o sube la foto desde tu equipo.
        </p>
        <div className="camera-fallback-actions">
          <button type="button" className="btn-action btn-bump" onClick={() => void start()}>
            🎥 Activar cámara
          </button>
          <label className="logout-btn camera-file-btn">
            Subir archivo
            <input type="file" accept="image/*" capture={facing} hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>
    );
  }

  // Vista normal de cámara.
  return (
    <div className="camera">
      <div className="camera-frame">
        <video ref={videoRef} playsInline muted />
        <div className="camera-guide" />
      </div>
      <button type="button" className="btn-action btn-bump" onClick={capture} disabled={!ready}>
        {ready ? "📸 Capturar" : "Activando cámara…"}
      </button>
    </div>
  );
}
