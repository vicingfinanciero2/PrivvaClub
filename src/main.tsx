/// <reference types="vite-plugin-pwa/client" />
// =====================================================================================
//  PrivvaClub — Punto de entrada de la PWA
//
//  Monta React y registra el Service Worker. Con registerType "autoUpdate", el nuevo
//  SW toma control apenas está disponible; aquí forzamos la actualización inmediata.
// =====================================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// ----- Registro del Service Worker -----
// onNeedRefresh: hay una versión nueva. Como usamos autoUpdate, aplicamos de inmediato
// (updateSW(true) recarga con la versión más reciente). En una UI más rica, podrías
// mostrar un toast "Nueva versión disponible" antes de recargar.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
  onOfflineReady() {
    // La app ya está cacheada y lista para funcionar sin conexión.
    console.info("[PWA] PrivvaClub lista para uso offline.");
  },
});

// ----- Montaje de React -----
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('No se encontró el elemento #root en index.html.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
