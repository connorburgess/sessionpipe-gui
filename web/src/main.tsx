// SPDX-License-Identifier: Apache-2.0
// Owned by: web. Entry: picks the transport (real, or the mock with VITE_MOCK=1 / ?mock=1),
// starts the store and renders the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { StoreContext } from "./data/hooks";
import { Store } from "./data/store";
import { createHttpTransport } from "./data/transport";
import { applySettings } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

applySettings();

const isMockMode = () => import.meta.env.VITE_MOCK === "1" || new URLSearchParams(location.search).get("mock") === "1";

async function boot() {
  const transport = isMockMode() ? (await import("./mock/index")).createMockTransport() : createHttpTransport();
  const store = new Store(transport);
  store.start();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>
    </StrictMode>,
  );
}

void boot();
