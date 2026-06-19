// =====================================================================================
//  PrivvaClub — CTA "Convertirse en creador(a)" + estado de la verificación
//
//  Aparece en Mi Cuenta. Según el estado de la solicitud muestra:
//    - sin solicitud / draft / rejected -> botón para abrir el asistente.
//    - submitted / in_review            -> "en revisión".
//    - approved                         -> "verificado".
// =====================================================================================

import { useCallback, useEffect, useState } from "react";
import { creatorService } from "../services/creatorService";
import BecomeCreatorWizard from "./BecomeCreatorWizard";
import type { CreatorApplication } from "../types/supabase";

export default function CreatorCta({ userId }: { userId: string }) {
  const [app, setApp] = useState<CreatorApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    try {
      setApp(await creatorService.getMyApplication(userId));
    } catch {
      /* silencioso: el CTA simplemente ofrecerá iniciar */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;

  const status = app?.status ?? null;

  // Estados "finales" de espera/aprobación.
  if (status === "submitted" || status === "in_review") {
    return (
      <div className="creator-cta in-review">
        <strong>⏳ Verificación en revisión</strong>
        <p className="muted">Estamos validando tu información. Te avisaremos cuando puedas monetizar.</p>
      </div>
    );
  }
  if (status === "approved") {
    return (
      <div className="creator-cta approved">
        <strong>✅ Creador(a) verificado</strong>
        <p className="muted">Tu cuenta está habilitada para monetizar.</p>
      </div>
    );
  }

  // Sin solicitud, borrador o rechazada -> ofrecer el asistente.
  return (
    <>
      <div className="creator-cta">
        <strong>💸 ¿List@ para ganar dinero?</strong>
        <p className="muted">
          {status === "rejected"
            ? `Tu verificación fue rechazada${app?.rejection_reason ? `: ${app.rejection_reason}` : ""}. Puedes volver a intentarlo.`
            : "Conviértete en creador(a): verifica tu identidad para publicar y cobrar."}
        </p>
        <button className="auth-submit" onClick={() => setShowWizard(true)}>
          {status === "rejected" ? "Reintentar verificación" : "Convertirse en creador(a)"}
        </button>
      </div>

      {showWizard && (
        <BecomeCreatorWizard
          userId={userId}
          onClose={() => setShowWizard(false)}
          onSubmitted={() => void load()}
        />
      )}
    </>
  );
}
