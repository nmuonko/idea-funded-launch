import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "mobile-update-cart-item",
  action: "update_item",
}));
