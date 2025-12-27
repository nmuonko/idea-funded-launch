import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { runStartupHealthCheck } from "./lib/supabaseHealth";

// Development diagnostics - log environment info and run health check on startup
if (import.meta.env.DEV) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  
  console.log('[App] Environment:', {
    hostname: window.location.hostname,
    supabaseUrl: supabaseUrl || 'NOT SET',
    hasAnonKey: !!supabaseKey,
    anonKeyLength: supabaseKey?.length || 0,
  });
  
  // Run startup health check
  runStartupHealthCheck();
}

createRoot(document.getElementById("root")!).render(<App />);
