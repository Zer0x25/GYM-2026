import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// PWA service worker (scaffold): offline shell caching only. The privileged
// offline mode (outbox, permissions P-09.3.1b) is a later unit and stays
// disabled until its ADR parameters are resolved (HITO0_PENDING in STATE.md).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // Non-fatal: the app works without the service worker online.
  });
}
