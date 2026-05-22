import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  expiresAt: string | null;
  status?: "active" | "refreshed" | "unavailable" | "verify_failed";
  className?: string;
}

/**
 * Small inline pill showing the remaining price-lock time.
 * Backend is the source of truth — this only displays the countdown.
 */
export function PriceLockBadge({ expiresAt, status = "active", className = "" }: Props) {
  const { language } = useLanguage();
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, ms));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (status === "unavailable") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-[11px] font-medium ${className}`}>
        <AlertTriangle className="w-3 h-3" />
        {language === "fr" ? "Indisponible" : "Unavailable"}
      </span>
    );
  }

  if (!expiresAt || remaining <= 0) return null;

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const timeStr = minutes > 0 ? `${minutes}m` : `${seconds}s`;

  const label =
    language === "fr"
      ? `Prix réservé · ${timeStr}`
      : `Price reserved · ${timeStr}`;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium ${className}`}>
      <Clock className="w-3 h-3" />
      {label}
    </span>
  );
}
