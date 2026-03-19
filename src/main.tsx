import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { runStartupHealthCheck } from "./lib/supabaseHealth";
import { bustStaleCache } from "./lib/cacheBust";

// Clear stale localStorage caches on new deployments and force a one-time reload on version mismatch
const canRenderApp = bustStaleCache();

// Development diagnostics
if (canRenderApp && import.meta.env.DEV) {
  runStartupHealthCheck();
}

if (canRenderApp) {
  createRoot(document.getElementById("root")!).render(<App />);
}
