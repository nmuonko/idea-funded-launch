import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { runStartupHealthCheck } from "./lib/supabaseHealth";
import { bustStaleCache } from "./lib/cacheBust";

// Clear stale localStorage caches on new deployments
bustStaleCache();

// Development diagnostics
if (import.meta.env.DEV) {
  runStartupHealthCheck();
}

createRoot(document.getElementById("root")!).render(<App />);
