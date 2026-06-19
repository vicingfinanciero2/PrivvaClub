// =====================================================================================
//  PrivvaClub — Captura de cámara en tiempo real (selfie KYC)
//
//  getUserMedia -> <video> -> canvas -> Blob. Botón capturar / repetir. Si la cámara
//  no está disponible o se deniega, cae a un input de archivo (fallback).
// =====================================================================================

import { useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  facing?: "user" | "environment";
  /** Devuelve la imagen capturada (blob) + una URL local para previsualizar. */
  onCapture: (blob: Blob, previewUrl: string) => void;
}

export default function CameraCapture({ facing = "user", onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        setDenied(true);
      }
    }
    void start();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

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
        onCapture(blob, url);
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    setShot(null);
  }

  function onFile(f: File | null) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setShot(url);
    onCapture(f, url);
  }

  if (denied) {
    return (
      <div className="camera-fallback">
        <p className="muted">No se pudo acceder a la cámara. Sube la foto desde tu galería:</p>
        <input type="file" accept="image/*" capture="user" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </div>
    );
  }

  return (
    <div className="camera">
      {shot ? (
        <>
          <img className="camera-shot" src={shot} alt="Captura" />
          <button type="button" className="logout-btn" onClick={retake}>
            Repetir
          </button>
        </>
      ) : (
        <>
          <div className="camera-frame">
            <video ref={videoRef} playsInline muted />
            <div className="camera-guide" />
          </div>
          <button type="button" className="btn-action btn-bump" onClick={capture} disabled={!ready}>
            {ready ? "📸 Capturar" : "Activando cámara…"}
          </button>
        </>
      )}
    </div>
  );
}
