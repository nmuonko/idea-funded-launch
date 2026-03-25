import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { runStartupHealthCheck } from "./lib/supabaseHealth";
import { bustStaleCache } from "./lib/cacheBust";

const canRenderApp = bustStaleCache();

if (canRenderApp && import.meta.env.DEV) {
  runStartupHealthCheck();
}

if (canRenderApp) {
  createRoot(document.getElementById("root")!).render(
    <HelmetProvider>
      <App />
    </HelmetProvider>
  );
}
