import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "mobile-delete-cart-item",
  action: "delete_item",
}));
