// =====================================================================================
//  PrivvaClub — Servicio de anuncios (feed, monetización y almacenamiento)
//
//  Concuerda con el backend:
//    - Feed: SELECT público de anuncios `active` (RLS de 0001 permite leer activos a anon).
//    - Monetización: RPCs fn_publish_ad / fn_bump_ad (cobran créditos en el servidor).
//    - Storage: bucket `ad-images`, ruta `<auth.uid()>/<ad_id>/<archivo>` (RLS de 0002).
// =====================================================================================

import { supabase } from "../lib/supabaseClient";
import type { Ad, AdStatus, AdVerification, City } from "../types/supabase";

const AD_IMAGES_BUCKET = "ad-images";

/** Anuncio del feed con sus relaciones embebidas (ciudad + sello de verificación). */
export interface AdFeedItem extends Ad {
  cities: Pick<City, "name" | "slug"> | null;
  ads_verification: Pick<AdVerification, "is_verified_by_studio"> | null;
}

function serviceError(action: string, message?: string): Error {
  return new Error(`[adsService] ${action} falló: ${message ?? "error desconocido"}`);
}

/**
 * Feed público por ciudad: solo anuncios `active`, ordenados por posicionamiento
 * (bumped_at DESC). Incluye datos de la ciudad y el sello del estudio en una sola query.
 * El filtro por slug usa el join interno con `cities`.
 */
export async function getActiveAdsByCity(citySlug: string): Promise<AdFeedItem[]> {
  const { data, error } = await supabase
    .from("ads")
    .select(
      "*, cities!inner(name, slug), ads_verification(is_verified_by_studio)",
    )
    .eq("status", "active")
    .eq("cities.slug", citySlug)
    .order("bumped_at", { ascending: false });

  if (error) throw serviceError("getActiveAdsByCity", error.message);
  return (data ?? []) as unknown as AdFeedItem[];
}

/**
 * Publica un anuncio (cobra créditos y lo pasa a `active`) vía RPC.
 * @returns el nuevo status del anuncio.
 */
export async function publishAd(adId: string): Promise<AdStatus> {
  const { data, error } = await supabase.rpc("fn_publish_ad", { target_ad_id: adId });
  if (error) throw serviceError("publishAd", error.message);
  return data as AdStatus;
}

/**
 * Reposiciona un anuncio en el feed (cobra créditos y actualiza bumped_at) vía RPC.
 * @returns el nuevo bumped_at (timestamptz ISO).
 */
export async function bumpAd(adId: string): Promise<string> {
  const { data, error } = await supabase.rpc("fn_bump_ad", { target_ad_id: adId });
  if (error) throw serviceError("bumpAd", error.message);
  return data as string;
}

/**
 * Sube una imagen al bucket `ad-images` respetando la convención de ruta
 * `<userId>/<adId>/<archivo>` (la RLS de Storage exige que la primera carpeta sea el uid).
 * @returns la URL pública lista para inyectar en ads.image_urls.
 */
export async function uploadAdImage(
  userId: string,
  adId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${adId}/${fileName}`;

  const { error } = await supabase.storage
    .from(AD_IMAGES_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });

  if (error) throw serviceError("uploadAdImage", error.message);

  const { data } = supabase.storage.from(AD_IMAGES_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw serviceError("uploadAdImage", "no se pudo resolver la URL pública");
  }
  return data.publicUrl;
}

/** Ciudades activas para poblar selects (ordenadas por sort_order). */
export async function getCities(): Promise<City[]> {
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw serviceError("getCities", error.message);
  return data ?? [];
}

/** Lista TODOS los anuncios del anunciante (cualquier status). RLS: solo los propios. */
export async function getMyAds(userId: string): Promise<Ad[]> {
  const { data, error } = await supabase
    .from("ads")
    .select("*")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw serviceError("getMyAds", error.message);
  return data ?? [];
}

/** Datos para crear un anuncio en borrador. */
export interface CreateDraftInput {
  profile_id: string;
  title: string;
  description?: string | null;
  price?: number | null;
  city_id: number;
  zone_neighborhood?: string | null;
  age: number;
  image_urls?: string[];
}

/**
 * Crea un anuncio en estado `draft`. La RLS exige profile_id = auth.uid().
 * @returns el anuncio recién creado.
 */
export async function createDraft(input: CreateDraftInput): Promise<Ad> {
  const { data, error } = await supabase
    .from("ads")
    .insert({
      profile_id: input.profile_id,
      title: input.title,
      description: input.description ?? null,
      price: input.price ?? null,
      city_id: input.city_id,
      zone_neighborhood: input.zone_neighborhood ?? null,
      age: input.age,
      image_urls: input.image_urls ?? [],
      status: "draft",
    })
    .select("*")
    .single();

  if (error) throw serviceError("createDraft", error.message);
  return data;
}

/** Asocia las URLs de imágenes a un anuncio (tras subirlas al bucket). */
export async function setAdImages(adId: string, urls: string[]): Promise<void> {
  const { error } = await supabase
    .from("ads")
    .update({ image_urls: urls })
    .eq("id", adId);
  if (error) throw serviceError("setAdImages", error.message);
}

/** Archiva un anuncio (lo retira del feed sin borrarlo). RLS: solo el dueño. */
export async function archiveAd(adId: string): Promise<void> {
  const { error } = await supabase
    .from("ads")
    .update({ status: "archived" })
    .eq("id", adId);
  if (error) throw serviceError("archiveAd", error.message);
}

/** Elimina un anuncio definitivamente (cascada: verificación y chats). RLS: solo el dueño. */
export async function deleteAd(adId: string): Promise<void> {
  const { error } = await supabase.from("ads").delete().eq("id", adId);
  if (error) throw serviceError("deleteAd", error.message);
}

export const adsService = {
  getActiveAdsByCity,
  getMyAds,
  getCities,
  createDraft,
  setAdImages,
  archiveAd,
  deleteAd,
  publishAd,
  bumpAd,
  uploadAdImage,
};
