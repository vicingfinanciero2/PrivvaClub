// =====================================================================================
//  PrivvaClub — Formulario de acceso del anunciante (Login / Registro)
//
//  Usa supabase.auth.signInWithPassword / signUp. Al iniciar sesión, el listener
//  onAuthStateChange (en App) actualiza el userId y MyAccount renderiza el panel.
//  En el registro, el username viaja en options.data y el trigger handle_new_user
//  lo usa al crear el profiles.
// =====================================================================================

import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

type Mode = "login" | "signup";

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        // onAuthStateChange en App actualiza la sesión automáticamente.
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username.trim() || null } },
        });
        if (err) throw err;
        // Si el proyecto exige confirmación por correo, no hay sesión todavía.
        if (!data.session) {
          setNotice("Cuenta creada. Revisa tu correo para confirmar el acceso.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          Privva<span>Club</span>
        </div>
        <p className="auth-sub">Panel de anunciantes</p>

        {/* Tabs login / signup */}
        <div className="auth-tabs">
          <button
            className={`auth-tab${mode === "login" ? " active" : ""}`}
            onClick={() => setMode("login")}
            type="button"
          >
            Iniciar sesión
          </button>
          <button
            className={`auth-tab${mode === "signup" ? " active" : ""}`}
            onClick={() => setMode("signup")}
            type="button"
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "signup" && (
            <label className="auth-field">
              <span>Nombre de usuario</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="tu_alias"
                autoComplete="username"
              />
            </label>
          )}

          <label className="auth-field">
            <span>Correo</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Procesando…" : mode === "login" ? "Entrar" : "Registrarme"}
          </button>
        </form>

        <p className="auth-foot muted">
          Solo los anunciantes necesitan cuenta. Los clientes navegan y chatean de forma anónima.
        </p>
      </div>
    </div>
  );
}
