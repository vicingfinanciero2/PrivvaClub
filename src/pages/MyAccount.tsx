// =====================================================================================
//  PrivvaClub — Panel del anunciante (modelo híbrido de monetización)
//
//  Muestra el estado de cuenta y dos tarjetas selectoras del modelo de facturación:
//    - "Plan por Créditos"  -> credit_balance actual.
//    - "Plan Suscripción Premium" -> vigencia (subscription_expires_at).
//  La tarjeta del modelo elegido (profiles.billing_model) se resalta como activa.
//  El historial de transacciones se lista debajo.
// =====================================================================================

import { useMemo } from "react";
import { useAdvertiserProfile } from "../hooks/useAdvertiserProfile";
import { supabase } from "../lib/supabaseClient";
import AuthForm from "../components/AuthForm";
import MyAds from "./MyAds";
import AdvertiserInbox from "../components/AdvertiserInbox";
import type { BillingModel } from "../types/supabase";

interface MyAccountProps {
  userId: string | null;
}

export default function MyAccount({ userId }: MyAccountProps) {
  const { profile, transactions, loading, error, refresh } = useAdvertiserProfile(userId);

  // ¿Suscripción vigente? (expira en el futuro)
  const subscriptionActive = useMemo(() => {
    if (!profile?.subscription_expires_at) return false;
    return new Date(profile.subscription_expires_at).getTime() > Date.now();
  }, [profile?.subscription_expires_at]);

  // Sin sesión: pintamos el formulario de acceso elegante.
  if (!userId) {
    return <AuthForm />;
  }
  if (loading) return <div className="state">Cargando tu cuenta…</div>;
  if (error) return <div className="state error">{error.message}</div>;
  if (!profile) return <div className="state">Perfil no encontrado.</div>;

  const active: BillingModel = profile.billing_model;

  // Cambia la preferencia de facturación (RLS permite al dueño actualizar su perfil).
  async function selectModel(model: BillingModel) {
    if (!userId || model === profile?.billing_model) return;
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ billing_model: model })
      .eq("id", userId);
    if (!updErr) void refresh();
  }

  return (
    <>
      <div className="account-head">
        <div className="section-title" style={{ marginBottom: 0 }}>Mi Cuenta</div>
        <button className="logout-btn" onClick={() => void supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </div>

      {/* Estado de cuenta */}
      <div className="card">
        <div className="card-title">{profile.username ?? "Anunciante"}</div>
        <div className="muted">
          Estado:{" "}
          <span className={`status-pill status-${profile.account_status}`}>
            {profile.account_status}
          </span>
        </div>
      </div>

      {/* Selector de modelo de monetización */}
      <div className="section-title">Modelo de monetización</div>
      <div className="plan-grid">
        {/* Plan por créditos */}
        <button
          className={`plan-card${active === "credits" ? " plan-active" : ""}`}
          onClick={() => void selectModel("credits")}
        >
          <div className="plan-head">Plan por Créditos</div>
          <div className="plan-value">{profile.credit_balance}</div>
          <div className="muted">créditos disponibles</div>
          <div className="plan-note">Pagas por publicar y por cada bump.</div>
          {active === "credits" && <div className="plan-tag">● Activo</div>}
        </button>

        {/* Plan suscripción premium */}
        <button
          className={`plan-card plan-premium${active === "subscription" ? " plan-active" : ""}`}
          onClick={() => void selectModel("subscription")}
        >
          <div className="plan-head">Suscripción Premium</div>
          <div className="plan-value">
            {subscriptionActive ? "Activa" : "Inactiva"}
          </div>
          <div className="muted">
            {profile.subscription_expires_at
              ? `Vence: ${new Date(profile.subscription_expires_at).toLocaleDateString("es-CO")}`
              : "Sin membresía"}
          </div>
          <div className="plan-note">Publica y haz bump sin gastar créditos.</div>
          {active === "subscription" && <div className="plan-tag">● Activo</div>}
        </button>
      </div>

      {/* Bandeja de chats en tiempo real. */}
      <AdvertiserInbox userId={userId} />

      {/* Gestión de anuncios (publicar / bump). Al cambiar créditos, refresca el header. */}
      <MyAds userId={userId} onCreditsChanged={() => void refresh()} />

      {/* Historial */}
      <div className="section-title">Movimientos ({transactions.length})</div>
      {transactions.length === 0 ? (
        <div className="state">Sin transacciones aún.</div>
      ) : (
        <ul>
          {transactions.map((tx) => (
            <li key={tx.id} className="card tx-row">
              <div>
                <div className="card-title">{tx.transaction_type}</div>
                <div className="muted">
                  {new Date(tx.created_at).toLocaleString("es-CO")}
                </div>
              </div>
              <div
                className="tx-amount"
                style={{ color: tx.amount >= 0 ? "var(--color-success)" : "var(--color-danger)" }}
              >
                {tx.amount >= 0 ? "+" : ""}
                {tx.amount}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
