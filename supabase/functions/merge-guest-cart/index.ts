import { createMobileCartCompatHandler } from "../_shared/mobileCartCompat.ts";

Deno.serve(createMobileCartCompatHandler({
  legacyPath: "merge-guest-cart",
  action: "merge_guest",
}));
