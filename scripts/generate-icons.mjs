// =====================================================================================
//  PrivvaClub — Generador de iconos PWA
//
//  Crea en ./public los assets que exige el manifest/index.html:
//    pwa-192x192.png · pwa-512x512.png · apple-touch-icon.png · favicon.ico
//
//  Uso:
//    npm i -D sharp png-to-ico
//    node scripts/generate-icons.mjs                 # placeholder Onyx con "P" dorada
//    node scripts/generate-icons.mjs ruta/logo.png   # a partir de tu logo (≥512x512, cuadrado)
// =====================================================================================

import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = "public";
const base = process.argv[2] || null;

// Placeholder Onyx Premium (fondo #0B0B0F, "P" dorada) si no se pasa una imagen base.
const placeholderSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0B0B0F"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#D4AF37"/>
      <stop offset="1" stop-color="#F0D98C"/>
    </linearGradient>
  </defs>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
        font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="300" fill="url(#g)">P</text>
</svg>`;

/** Devuelve un pipeline de sharp para un tamaño dado, desde el logo o el placeholder. */
function source(size) {
  if (base) {
    return sharp(base).resize(size, size, { fit: "cover" });
  }
  return sharp(Buffer.from(placeholderSvg(size)));
}

async function pngAt(size) {
  return source(size).png().toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // PNGs del manifest + apple-touch-icon.
  const targets = [
    ["pwa-192x192.png", 192],
    ["pwa-512x512.png", 512],
    ["apple-touch-icon.png", 180],
  ];
  for (const [name, size] of targets) {
    const buf = await pngAt(size);
    await writeFile(path.join(OUT, name), buf);
    console.log(`✓ ${name} (${size}x${size})`);
  }

  // favicon.ico (multi-tamaño 16/32/48).
  const icoSources = await Promise.all([16, 32, 48].map((s) => pngAt(s)));
  const ico = await pngToIco(icoSources);
  await writeFile(path.join(OUT, "favicon.ico"), ico);
  console.log("✓ favicon.ico (16/32/48)");

  console.log(`\nListo. Iconos generados en ./${OUT}/${base ? "" : "  (placeholder — reemplázalos por tu logo cuando lo tengas)"}`);
}

main().catch((err) => {
  console.error("Error generando iconos:", err);
  process.exit(1);
});
