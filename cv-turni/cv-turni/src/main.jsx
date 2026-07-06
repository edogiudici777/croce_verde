import React from "react";
import ReactDOM from "react-dom/client";

// Storage PER PRIMO, così window.storage è pronto prima del componente.
import "./storage.js";

import { registerSW } from "./pwa.js";
import App from "./TurniSquadra.jsx";

// Registra il service worker (abilita installazione + notifiche).
registerSW();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
