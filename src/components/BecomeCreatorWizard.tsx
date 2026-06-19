// =====================================================================================
//  PrivvaClub — Asistente "Convertirse en creador(a)" (KYC paso a paso)
//
//  Una sola cosa por pantalla, con barra de progreso, ejemplos/indicaciones y mensajes
//  de error claros. Pasos: 1) Personal · 2) Documento · 3) Selfie · 4) Banca · 5) Redes.
//  Al enviar, sube los archivos al bucket privado, guarda el borrador y llama a la RPC.
//
//  NOTA: el reconocimiento facial automático es una integración posterior (Edge Function
//  + proveedor KYC). Aquí se capturan y almacenan las evidencias para revisión.
// =====================================================================================

import { useState } from "react";
import { creatorService } from "../services/creatorService";
import CameraCapture from "./CameraCapture";

interface BecomeCreatorWizardProps {
  userId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const STEPS = ["Personal", "Documento", "Selfie", "Banca", "Redes"] as const;

// --- Captura local de una foto (blob + preview) ---
interface Shot {
  blob: Blob;
  url: string;
  ext: string;
}

function PhotoTips({ items }: { items: string[] }) {
  return (
    <ul className="kyc-tips">
      {items.map((t) => (
        <li key={t}>✓ {t}</li>
      ))}
    </ul>
  );
}

export default function BecomeCreatorWizard({ userId, onClose, onSubmitted }: BecomeCreatorWizardProps) {
  const [step, setStep] = useState(0);

  // Paso 1
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [docType, setDocType] = useState("cc");
  const [docNumber, setDocNumber] = useState("");
  // Paso 2
  const [docFront, setDocFront] = useState<Shot | null>(null);
  const [docBack, setDocBack] = useState<Shot | null>(null);
  // Paso 3
  const [selfie, setSelfie] = useState<Shot | null>(null);
  const [selfieDoc, setSelfieDoc] = useState<Shot | null>(null);
  // Paso 4
  const [bankName, setBankName] = useState("");
  const [bankType, setBankType] = useState("ahorros");
  const [bankNumber, setBankNumber] = useState("");
  // Paso 5
  const [ig, setIg] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [x, setX] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function fileToShot(f: File | null, set: (s: Shot | null) => void) {
    if (!f) return set(null);
    const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
    set({ blob: f, url: URL.createObjectURL(f), ext });
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (fullName.trim().length < 3) return "Escribe tu nombre completo.";
      if (!birthDate) return "Indica tu fecha de nacimiento.";
      const age = (Date.now() - new Date(birthDate).getTime()) / (365.25 * 864e5);
      if (age < 18) return "Debes ser mayor de 18 años.";
      if (docNumber.trim().length < 4) return "Número de documento inválido.";
    }
    if (step === 1 && !docFront) return "Sube la parte frontal de tu documento.";
    if (step === 2) {
      if (!selfie) return "Toma tu selfie.";
      if (!selfieDoc) return "Toma la foto sosteniendo tu documento.";
    }
    if (step === 3) {
      if (bankName.trim().length < 2) return "Indica el banco.";
      if (bankNumber.trim().length < 4) return "Número de cuenta inválido.";
    }
    return null;
  }

  function next() {
    const v = validateStep();
    if (v) return setError(v);
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // Subir evidencias al bucket privado.
      const docFrontPath = docFront ? await creatorService.uploadKyc(userId, "doc-front", docFront.blob, docFront.ext) : null;
      const docBackPath = docBack ? await creatorService.uploadKyc(userId, "doc-back", docBack.blob, docBack.ext) : null;
      const selfiePath = selfie ? await creatorService.uploadKyc(userId, "selfie", selfie.blob, selfie.ext) : null;
      const selfieDocPath = selfieDoc ? await creatorService.uploadKyc(userId, "selfie-doc", selfieDoc.blob, selfieDoc.ext) : null;

      // Guardar borrador con todos los datos.
      await creatorService.saveApplication(userId, {
        full_name: fullName.trim(),
        birth_date: birthDate,
        doc_type: docType,
        doc_number: docNumber.trim(),
        doc_front_path: docFrontPath,
        doc_back_path: docBackPath,
        selfie_path: selfiePath,
        selfie_with_doc_path: selfieDocPath,
        bank_name: bankName.trim(),
        bank_account_type: bankType,
        bank_account_number: bankNumber.trim(),
        social_instagram: ig.trim() || null,
        social_tiktok: tiktok.trim() || null,
        social_x: x.trim() || null,
      });

      // Enviar a revisión (valida completitud en el servidor).
      await creatorService.submitApplication();
      setDone(true);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la verificación.");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = Math.round((Math.min(step, STEPS.length) / STEPS.length) * 100);

  return (
    <div className="chat-overlay" role="dialog" aria-modal="true">
      <div className="chat-window kyc-window" onClick={(e) => e.stopPropagation()}>
        <header className="chat-header">
          <div>
            <div className="chat-header-title">Convertirse en creador(a)</div>
            <div className="chat-header-sub">
              {step < STEPS.length ? `Paso ${step + 1} de ${STEPS.length} · ${STEPS[step]}` : "Revisar y enviar"}
            </div>
          </div>
          <button className="chat-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        {/* Barra de progreso */}
        <div className="kyc-progress">
          <div className="kyc-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="kyc-body">
          {done ? (
            <div className="state">
              <div style={{ fontSize: 40 }}>🎉</div>
              <strong>¡Verificación enviada!</strong>
              <p className="muted">La revisaremos pronto. Te avisaremos cuando tu cuenta quede habilitada para monetizar.</p>
            </div>
          ) : (
            <>
              {/* Paso 1 — Personal */}
              {step === 0 && (
                <div className="kyc-step">
                  <p className="muted">Cuéntanos quién eres. Estos datos son privados.</p>
                  <label className="auth-field"><span>Nombre completo</span>
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Como aparece en tu documento" />
                  </label>
                  <label className="auth-field"><span>Fecha de nacimiento</span>
                    <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                  </label>
                  <div className="newad-row">
                    <label className="auth-field"><span>Tipo de documento</span>
                      <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                        <option value="cc">Cédula de ciudadanía</option>
                        <option value="ce">Cédula de extranjería</option>
                        <option value="passport">Pasaporte</option>
                      </select>
                    </label>
                    <label className="auth-field"><span>Número</span>
                      <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} inputMode="numeric" />
                    </label>
                  </div>
                </div>
              )}

              {/* Paso 2 — Documento */}
              {step === 1 && (
                <div className="kyc-step">
                  <p className="muted">Sube tu documento oficial.</p>
                  <PhotoTips items={["Buena iluminación", "Sin reflejos ni brillos", "Que se lea todo el texto", "Sin recortes"]} />
                  <label className="auth-field"><span>Frente del documento *</span>
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => fileToShot(e.target.files?.[0] ?? null, setDocFront)} />
                  </label>
                  {docFront && <img className="kyc-preview" src={docFront.url} alt="Frente" />}
                  <label className="auth-field"><span>Reverso (opcional)</span>
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => fileToShot(e.target.files?.[0] ?? null, setDocBack)} />
                  </label>
                  {docBack && <img className="kyc-preview" src={docBack.url} alt="Reverso" />}
                </div>
              )}

              {/* Paso 3 — Selfie */}
              {step === 2 && (
                <div className="kyc-step">
                  <p className="muted">Verifiquemos que eres tú.</p>
                  <PhotoTips items={["Rostro centrado y visible", "Sin gorra ni gafas oscuras", "Buena luz, sin contraluz"]} />
                  <div className="kyc-label">Selfie *</div>
                  {selfie ? <img className="kyc-preview" src={selfie.url} alt="Selfie" /> : null}
                  <CameraCapture facing="user" onCapture={(blob, url) => setSelfie({ blob, url, ext: "jpg" })} />
                  <div className="kyc-label">Sosteniendo tu documento *</div>
                  {selfieDoc ? <img className="kyc-preview" src={selfieDoc.url} alt="Selfie con documento" /> : null}
                  <CameraCapture facing="user" onCapture={(blob, url) => setSelfieDoc({ blob, url, ext: "jpg" })} />
                </div>
              )}

              {/* Paso 4 — Banca */}
              {step === 3 && (
                <div className="kyc-step">
                  <p className="muted">¿Dónde quieres recibir tus pagos?</p>
                  <label className="auth-field"><span>Banco</span>
                    <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ej. Bancolombia" />
                  </label>
                  <div className="newad-row">
                    <label className="auth-field"><span>Tipo de cuenta</span>
                      <select value={bankType} onChange={(e) => setBankType(e.target.value)}>
                        <option value="ahorros">Ahorros</option>
                        <option value="corriente">Corriente</option>
                      </select>
                    </label>
                    <label className="auth-field"><span>Número de cuenta</span>
                      <input value={bankNumber} onChange={(e) => setBankNumber(e.target.value)} inputMode="numeric" />
                    </label>
                  </div>
                </div>
              )}

              {/* Paso 5 — Redes */}
              {step === 4 && (
                <div className="kyc-step">
                  <p className="muted">Opcional: ayuda a validar tu identidad y a destacar tu perfil.</p>
                  <label className="auth-field"><span>Instagram</span>
                    <input value={ig} onChange={(e) => setIg(e.target.value)} placeholder="@usuario" />
                  </label>
                  <label className="auth-field"><span>TikTok</span>
                    <input value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="@usuario" />
                  </label>
                  <label className="auth-field"><span>X (Twitter)</span>
                    <input value={x} onChange={(e) => setX(e.target.value)} placeholder="@usuario" />
                  </label>
                </div>
              )}

              {/* Revisar */}
              {step === STEPS.length && (
                <div className="kyc-step">
                  <strong>Revisa antes de enviar</strong>
                  <ul className="kyc-review">
                    <li>👤 {fullName} · {docType.toUpperCase()} {docNumber}</li>
                    <li>🪪 Documento {docFront ? "✓" : "—"}{docBack ? " (+ reverso)" : ""}</li>
                    <li>🤳 Selfie {selfie ? "✓" : "—"} · con documento {selfieDoc ? "✓" : "—"}</li>
                    <li>🏦 {bankName} · {bankType} · ****{bankNumber.slice(-4)}</li>
                    <li>🔗 {[ig, tiktok, x].filter(Boolean).join(" · ") || "Sin redes"}</li>
                  </ul>
                  <p className="muted">Al enviar, revisaremos tu información para habilitar la monetización.</p>
                </div>
              )}

              {error && <div className="auth-error">{error}</div>}
            </>
          )}
        </div>

        {!done && (
          <div className="kyc-actions">
            {step > 0 && (
              <button className="logout-btn" onClick={back} disabled={submitting}>Atrás</button>
            )}
            {step < STEPS.length ? (
              <button className="auth-submit" onClick={next}>Continuar</button>
            ) : (
              <button className="auth-submit" onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? "Enviando…" : "Enviar verificación"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
