import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "mobile-get-cart",
  action: "get_cart",
  allowGetPassthrough: true,
}));
