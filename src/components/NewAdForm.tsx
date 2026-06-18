// =====================================================================================
//  PrivvaClub — Formulario de alta de anuncio (anunciante)
//
//  Flujo:
//    1. createDraft(...)            -> crea el anuncio en estado 'draft' y devuelve su id.
//    2. uploadAdImage(uid, adId, f) -> sube cada foto a ad-images/<uid>/<adId>/...
//    3. setAdImages(adId, urls)     -> guarda las URLs públicas en el anuncio.
//  El anuncio queda en borrador; se publica luego con fn_publish_ad (siguiente fase).
// =====================================================================================

import { useEffect, useState, type FormEvent } from "react";
import { adsService } from "../services/adsService";
import type { Ad, City } from "../types/supabase";

interface NewAdFormProps {
  userId: string;
  /** Se invoca con el anuncio creado (en draft). */
  onCreated?: (ad: Ad) => void;
}

export default function NewAdForm({ userId, onCreated }: NewAdFormProps) {
  const [cities, setCities] = useState<City[]>([]);

  // Campos del formulario.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [age, setAge] = useState("");
  const [cityId, setCityId] = useState<number | "">("");
  const [zone, setZone] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Carga dinámica de ciudades.
  useEffect(() => {
    let alive = true;
    adsService
      .getCities()
      .then((data) => {
        if (!alive) return;
        setCities(data);
        if (data.length > 0) setCityId(data[0].id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "No se pudieron cargar las ciudades"),
      );
    return () => {
      alive = false;
    };
  }, []);

  function validate(): string | null {
    if (title.trim().length < 3) return "El título debe tener al menos 3 caracteres.";
    if (cityId === "") return "Selecciona una ciudad.";
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < 18) return "La edad debe ser un número ≥ 18.";
    if (price !== "" && Number(price) < 0) return "El precio no puede ser negativo.";
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);
    setDone(false);

    try {
      // 1) Crear el borrador.
      const ad = await adsService.createDraft({
        profile_id: userId,
        title: title.trim(),
        description: description.trim() || null,
        price: price === "" ? null : Number(price),
        city_id: Number(cityId),
        zone_neighborhood: zone.trim() || null,
        age: Number(age),
      });

      // 2) Subir imágenes (si las hay) a su carpeta <uid>/<adId>/...
      if (files.length > 0) {
        const urls: string[] = [];
        for (const file of files) {
          urls.push(await adsService.uploadAdImage(userId, ad.id, file));
        }
        // 3) Asociar las URLs al anuncio.
        await adsService.setAdImages(ad.id, urls);
        ad.image_urls = urls;
      }

      setDone(true);
      // Reset del formulario.
      setTitle("");
      setDescription("");
      setPrice("");
      setAge("");
      setZone("");
      setFiles([]);
      onCreated?.(ad);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el anuncio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="newad-form" onSubmit={handleSubmit}>
      <div className="section-title">Nuevo anuncio</div>

      <label className="auth-field">
        <span>Título</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Acompañamiento exclusivo"
          maxLength={160}
          required
        />
      </label>

      <label className="auth-field">
        <span>Descripción</span>
        <textarea
          className="newad-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe tu servicio…"
          maxLength={4000}
          rows={4}
        />
      </label>

      <div className="newad-row">
        <label className="auth-field">
          <span>Ciudad</span>
          <select
            value={cityId}
            onChange={(e) => setCityId(e.target.value === "" ? "" : Number(e.target.value))}
            required
          >
            {cities.length === 0 && <option value="">Cargando…</option>}
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="auth-field">
          <span>Zona / barrio</span>
          <input
            type="text"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="Ej. Chapinero"
          />
        </label>
      </div>

      <div className="newad-row">
        <label className="auth-field">
          <span>Edad</span>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={18}
            placeholder="≥ 18"
            required
          />
        </label>

        <label className="auth-field">
          <span>Precio (COP)</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min={0}
            step={1000}
            placeholder="Opcional"
          />
        </label>
      </div>

      <label className="auth-field">
        <span>Fotos</span>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
        />
        {files.length > 0 && (
          <span className="muted">{files.length} archivo(s) seleccionado(s)</span>
        )}
      </label>

      {error && <div className="auth-error">{error}</div>}
      {done && <div className="auth-notice">Anuncio creado en borrador. Ya puedes publicarlo.</div>}

      <button className="auth-submit" type="submit" disabled={loading}>
        {loading ? "Creando…" : "Crear borrador"}
      </button>
    </form>
  );
}
