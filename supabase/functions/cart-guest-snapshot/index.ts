import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "cart-guest-snapshot",
  action: "guest_snapshot",
}));
