import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "cart-sync-from-client",
  action: "sync",
}));
