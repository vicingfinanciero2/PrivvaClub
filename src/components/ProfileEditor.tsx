// =====================================================================================
//  PrivvaClub — Editor de perfil del ofertante (baja fricción)
//
//  Permite personalizar foto, nombre de usuario y biografía sin verificar identidad.
//  Foto → profileService.uploadAvatar; datos → profileService.updateProfile.
// =====================================================================================

import { useRef, useState, type FormEvent } from "react";
import { profileService } from "../services/profileService";
import type { Profile } from "../types/supabase";

interface ProfileEditorProps {
  profile: Profile;
  onSaved: () => void;
}

export default function ProfileEditor({ profile, onSaved }: ProfileEditorProps) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [preview, setPreview] = useState<string | null>(profile.avatar_url);
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setDone(false);
    if (f) setPreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (username.trim().length < 3) {
      setError("El nombre de usuario debe tener al menos 3 caracteres.");
      return;
    }
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      let avatarUrl = profile.avatar_url;
      if (file) {
        avatarUrl = await profileService.uploadAvatar(profile.id, file);
      }
      await profileService.updateProfile(profile.id, {
        username: username.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
      });
      setDone(true);
      setFile(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="newad-form" onSubmit={handleSubmit}>
      <div className="profile-avatar-row">
        <div className="profile-avatar" onClick={() => fileRef.current?.click()}>
          {preview ? <img src={preview} alt="Avatar" /> : <span>📷</span>}
        </div>
        <div>
          <button type="button" className="logout-btn" onClick={() => fileRef.current?.click()}>
            Cambiar foto
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <label className="auth-field">
        <span>Nombre de usuario</span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          required
        />
      </label>

      <label className="auth-field">
        <span>Biografía</span>
        <textarea
          className="newad-textarea"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Cuéntales quién eres…"
          maxLength={500}
          rows={3}
        />
        <span className="muted" style={{ fontSize: 12 }}>{bio.length}/500</span>
      </label>

      {error && <div className="auth-error">{error}</div>}
      {done && <div className="auth-notice">Perfil actualizado.</div>}

      <button className="auth-submit" type="submit" disabled={saving}>
        {saving ? "Guardando…" : "Guardar perfil"}
      </button>
    </form>
  );
}
