/**
 * Admin Bootstrap Catalog
 * 
 * One-time setup endpoint that ALWAYS populates DB:
 * 1. Seeds default catalog queries (inline, not separate function call)
 * 2. Runs live refresh for ALL categories (catalog-refresh-seeded?mode=live)
 * 3. Backfills unified_category, listing_type, and subkeys for existing items
 * 
 * POST /admin-bootstrap-catalog
 * Body: { runBackfill?: boolean, maxSeeds?: number }
 * 
 * Requires: admin auth
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-admin-key",
};

function checkAdminKey(req: Request): boolean {
  const adminKey = req.headers.get("x-admin-key");
  const expectedKey = Deno.env.get("CRON_SECRET");
  if (adminKey && expectedKey && adminKey === expectedKey) return true;
  // Also accept anon key for automated calls
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.replace("Bearer ", "");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (anonKey && token === anonKey) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASSIVE SEED LIBRARY — Target: 50-200 seeds per category for 2k-6k items
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SEEDS = [
  // ════════════════════════════════════════════════════════════════════
  // PHONES (electronics, subcategory: phones) — ~40 seeds
  // ════════════════════════════════════════════════════════════════════
  // iPhone series
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_15", query: "iphone 15 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_15_pro", query: "iphone 15 pro max unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_14", query: "iphone 14 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_14_pro", query: "iphone 14 pro max", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_13", query: "iphone 13 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_13_pro", query: "iphone 13 pro max", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_12", query: "iphone 12 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_se", query: "iphone se unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_pro", query: "iphone pro max unlocked", filters: { unifiedSubcategory: "phones" } },
  // Samsung Galaxy
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s24", query: "samsung galaxy s24 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s24_ultra", query: "samsung galaxy s24 ultra", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s23", query: "samsung galaxy s23 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s23_ultra", query: "samsung galaxy s23 ultra", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_a54", query: "samsung galaxy a54", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_a34", query: "samsung galaxy a34", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_a15", query: "samsung galaxy a15", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_a25", query: "samsung galaxy a25", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_m14", query: "samsung galaxy m14", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_galaxy", query: "samsung galaxy unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_zfold", query: "samsung galaxy z fold", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_zflip", query: "samsung galaxy z flip", filters: { unifiedSubcategory: "phones" } },
  // DRC Popular Brands
  { category: "electronics", provider: "ebay", seed_key: "phones_tecno_camon", query: "tecno camon", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_tecno_spark", query: "tecno spark", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_tecno_pova", query: "tecno pova", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_infinix_hot", query: "infinix hot", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_infinix_note", query: "infinix note", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_infinix_zero", query: "infinix zero", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_itel", query: "itel phone", filters: { unifiedSubcategory: "phones" } },
  // Other brands
  { category: "electronics", provider: "ebay", seed_key: "phones_pixel", query: "google pixel unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_pixel_8", query: "google pixel 8 pro", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_oneplus", query: "oneplus phone unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_oneplus_12", query: "oneplus 12", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_xiaomi_redmi", query: "xiaomi redmi note", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_xiaomi_poco", query: "xiaomi poco phone", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_motorola", query: "motorola moto phone", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_oppo", query: "oppo phone", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_realme", query: "realme phone", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_huawei", query: "huawei phone", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_nothing", query: "nothing phone", filters: { unifiedSubcategory: "phones" } },

  // ════════════════════════════════════════════════════════════════════
  // GAMING (electronics, subcategory: gaming) — ~30 seeds
  // STRICT: consoles/controllers/games ONLY — NO PC/peripherals
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5", query: "ps5 console playstation 5", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_slim", query: "ps5 slim console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_digital", query: "ps5 digital edition console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_bundle", query: "ps5 console bundle", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps4", query: "ps4 console playstation 4", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps4_pro", query: "ps4 pro console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_x", query: "xbox series x console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_s", query: "xbox series s console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_one", query: "xbox one console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_nintendo", query: "nintendo switch console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_oled", query: "nintendo switch oled", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_switch_lite", query: "nintendo switch lite", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_vr", query: "meta quest vr headset", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_quest_3", query: "meta quest 3", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_psvr", query: "playstation vr2", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_steam_deck", query: "steam deck handheld", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_rog_ally", query: "rog ally handheld", filters: { unifiedSubcategory: "gaming" } },
  // Controllers
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_controller", query: "ps5 dualsense controller", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_controller", query: "xbox wireless controller", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_pro_controller", query: "nintendo pro controller", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_scuf", query: "scuf controller", filters: { unifiedSubcategory: "gaming" } },
  // Games
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_games", query: "ps5 games lot", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_games", query: "xbox series games", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_switch_games", query: "nintendo switch games", filters: { unifiedSubcategory: "gaming" } },
  // Gaming headsets (console gaming headsets, NOT PC peripherals)
  { category: "electronics", provider: "ebay", seed_key: "gaming_headset", query: "gaming headset ps5 xbox", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_retro", query: "retro gaming console", filters: { unifiedSubcategory: "gaming" } },

  // ════════════════════════════════════════════════════════════════════
  // AUDIO (electronics, subcategory: audio) — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "ebay", seed_key: "audio_airpods", query: "airpods pro", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_airpods_max", query: "airpods max", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_headphones_wireless", query: "wireless headphones bluetooth", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_jbl_speaker", query: "jbl bluetooth speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_jbl_flip", query: "jbl flip speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_jbl_charge", query: "jbl charge speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_sony_wh", query: "sony wh-1000xm headphones", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_sony_earbuds", query: "sony wf earbuds", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_bose_speaker", query: "bose bluetooth speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_bose_headphones", query: "bose quietcomfort headphones", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_beats", query: "beats headphones wireless", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_beats_studio", query: "beats studio buds", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_soundbar", query: "soundbar home theater", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_samsung_soundbar", query: "samsung soundbar", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_sonos", query: "sonos speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_marshall", query: "marshall speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_earbuds", query: "wireless earbuds", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_sennheiser", query: "sennheiser headphones", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_noise_cancel", query: "noise cancelling headphones", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_studio_monitor", query: "studio monitor speakers", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_portable", query: "portable bluetooth speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_harman_kardon", query: "harman kardon speaker", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "audio_subwoofer", query: "subwoofer home audio", filters: { unifiedSubcategory: "audio" } },

  // ════════════════════════════════════════════════════════════════════
  // TABLETS (electronics, subcategory: tablets) — ~15 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "ebay", seed_key: "tablets_ipad_pro", query: "ipad pro", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_ipad_air", query: "ipad air", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_ipad_mini", query: "ipad mini", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_ipad_10th", query: "ipad 10th generation", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_samsung_tab_s9", query: "samsung galaxy tab s9", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_samsung_tab_a", query: "samsung galaxy tab a", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_fire_hd", query: "amazon fire hd tablet", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_lenovo", query: "lenovo tab tablet", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "tablets_surface_pro", query: "microsoft surface pro", filters: { unifiedSubcategory: "tablets" } },

  // ════════════════════════════════════════════════════════════════════
  // COMPUTERS (electronics, subcategory: computers) — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "ebay", seed_key: "computers_macbook_pro", query: "macbook pro laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_macbook_air", query: "macbook air laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_macbook_m3", query: "macbook m3", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_dell_xps", query: "dell xps laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_hp_laptop", query: "hp laptop computer", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_lenovo_thinkpad", query: "lenovo thinkpad", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_asus_laptop", query: "asus laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_chromebook", query: "chromebook laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_desktop", query: "desktop computer pc", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_imac", query: "imac apple desktop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "computers_mini_pc", query: "mini pc desktop", filters: { unifiedSubcategory: "computers" } },

  // ════════════════════════════════════════════════════════════════════
  // MONITORS (electronics, subcategory: monitors) — ~8 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "ebay", seed_key: "monitors_gaming", query: "gaming monitor 27 inch", filters: { unifiedSubcategory: "monitors" } },
  { category: "electronics", provider: "ebay", seed_key: "monitors_4k", query: "4k monitor", filters: { unifiedSubcategory: "monitors" } },
  { category: "electronics", provider: "ebay", seed_key: "monitors_ultrawide", query: "ultrawide monitor", filters: { unifiedSubcategory: "monitors" } },
  { category: "electronics", provider: "ebay", seed_key: "monitors_lg", query: "lg monitor", filters: { unifiedSubcategory: "monitors" } },
  { category: "electronics", provider: "ebay", seed_key: "monitors_samsung", query: "samsung monitor", filters: { unifiedSubcategory: "monitors" } },
  { category: "electronics", provider: "ebay", seed_key: "monitors_dell", query: "dell monitor", filters: { unifiedSubcategory: "monitors" } },

  // ════════════════════════════════════════════════════════════════════
  // VEHICLES — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_toyota_camry", query: "toyota camry car", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_civic", query: "honda civic sedan", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_accord", query: "honda accord", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_ford_f150", query: "ford f150 truck", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_ford_explorer", query: "ford explorer suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_bmw_3", query: "bmw 3 series sedan", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_bmw_x5", query: "bmw x5 suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_mercedes_c", query: "mercedes c class", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_mercedes_gle", query: "mercedes gle suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_suv_4x4", query: "SUV 4x4 vehicle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_tesla_model_3", query: "tesla model 3", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 5000, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "charger", "adapter"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_tesla_model_y", query: "tesla model y", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 5000, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "charger", "adapter"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_toyota_rav4", query: "toyota rav4", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_nissan_altima", query: "nissan altima", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_chevy_silverado", query: "chevrolet silverado truck", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  // Motorcycles
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_harley", query: "harley davidson motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage", "helmet", "jacket"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_moto", query: "honda motorcycle cruiser", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_kawasaki", query: "kawasaki motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_yamaha_moto", query: "yamaha motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  // Powersports & Boats
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_atv", query: "ATV four wheeler", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "powersports", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_utv", query: "UTV side by side", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "powersports", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_boat", query: "fishing boat motor", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "boats", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_rv", query: "RV camper trailer", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 2000, listingType: "vehicle", vehiclesSubkey: "rvs_campers", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_classic", query: "classic muscle car", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 5000, listingType: "vehicle", vehiclesSubkey: "classic_cars", excludeKeywords: ["parts", "repair", "salvage", "model", "toy"] } },

  // ════════════════════════════════════════════════════════════════════
  // PARTS & ACCESSORIES — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_brake_pads", query: "brake pads rotor kit", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_alternator", query: "alternator car truck", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_radiator", query: "radiator car truck", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_headlight", query: "headlight assembly", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_catalytic", query: "catalytic converter", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_starter", query: "starter motor car", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_struts", query: "struts shocks suspension", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_air_filter", query: "air filter engine", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_oil_filter", query: "oil filter kit", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_spark_plug", query: "spark plug set", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_battery", query: "car battery", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_caliper", query: "brake caliper", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_water_pump", query: "water pump engine", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_wheels_tires", query: "wheels tires rims", filters: { listingType: "part", partsSubkey: "wheels_tires" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_alloy_wheels", query: "alloy wheels set", filters: { listingType: "part", partsSubkey: "wheels_tires" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_motorcycle", query: "motorcycle parts accessories", filters: { listingType: "part", partsSubkey: "moto_scooter_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_atv_utv", query: "ATV UTV parts", filters: { listingType: "part", partsSubkey: "atv_utv_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_tools", query: "automotive tools equipment", filters: { listingType: "part", partsSubkey: "tools_supplies" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_exhaust", query: "exhaust system muffler", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_turbo", query: "turbocharger turbo", filters: { listingType: "part", partsSubkey: "car_truck_parts" } },

  // ════════════════════════════════════════════════════════════════════
  // HOME & GARDEN — ~30 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "home_garden", provider: "ebay", seed_key: "home_vacuum", query: "robot vacuum cleaner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_dyson_vacuum", query: "dyson vacuum cleaner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_airfryer", query: "air fryer kitchen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_blender", query: "blender kitchen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_tools", query: "power tool set" },
  { category: "home_garden", provider: "ebay", seed_key: "home_instant_pot", query: "instant pot pressure cooker" },
  { category: "home_garden", provider: "ebay", seed_key: "home_coffee_maker", query: "coffee maker machine" },
  { category: "home_garden", provider: "ebay", seed_key: "home_espresso", query: "espresso machine" },
  { category: "home_garden", provider: "ebay", seed_key: "home_stand_mixer", query: "stand mixer kitchen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_microwave", query: "microwave oven" },
  { category: "home_garden", provider: "ebay", seed_key: "home_toaster", query: "toaster oven" },
  { category: "home_garden", provider: "ebay", seed_key: "home_refrigerator", query: "mini refrigerator fridge" },
  { category: "home_garden", provider: "ebay", seed_key: "home_washing", query: "portable washing machine" },
  { category: "home_garden", provider: "ebay", seed_key: "home_ac", query: "portable air conditioner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_fan", query: "tower fan standing" },
  { category: "home_garden", provider: "ebay", seed_key: "home_heater", query: "space heater electric" },
  { category: "home_garden", provider: "ebay", seed_key: "home_generator", query: "portable generator" },
  { category: "home_garden", provider: "ebay", seed_key: "home_solar", query: "solar panel kit" },
  { category: "home_garden", provider: "ebay", seed_key: "home_dehumidifier", query: "dehumidifier" },
  { category: "home_garden", provider: "ebay", seed_key: "home_purifier", query: "air purifier hepa" },
  { category: "home_garden", provider: "ebay", seed_key: "home_garden_tools", query: "garden tools set" },
  { category: "home_garden", provider: "ebay", seed_key: "home_lawnmower", query: "lawn mower electric" },
  { category: "home_garden", provider: "ebay", seed_key: "home_drill", query: "cordless drill set" },
  { category: "home_garden", provider: "ebay", seed_key: "home_pressure_washer", query: "pressure washer" },
  { category: "home_garden", provider: "ebay", seed_key: "home_cookware", query: "cookware set pots pans" },
  { category: "home_garden", provider: "ebay", seed_key: "home_bedding", query: "bedding set comforter" },
  { category: "home_garden", provider: "ebay", seed_key: "home_curtains", query: "curtains window" },
  { category: "home_garden", provider: "ebay", seed_key: "home_rug", query: "area rug carpet" },

  // ════════════════════════════════════════════════════════════════════
  // CLOTHING, SHOES & ACCESSORIES — ~40 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_men_hoodie", query: "men hoodie" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_women_dress", query: "women dress" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_kids_shoes", query: "kids shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sneakers_men", query: "sneakers men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sneakers_women", query: "sneakers women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_boots", query: "boots men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_boots_women", query: "boots women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_handbag", query: "handbag women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_backpack", query: "backpack" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jacket", query: "jacket men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jacket_women", query: "jacket women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_coat", query: "winter coat" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jeans", query: "jeans men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jeans_women", query: "jeans women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tshirt", query: "t-shirt men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_polo", query: "polo shirt" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sweater", query: "sweater" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_cardigan", query: "cardigan women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sunglasses", query: "sunglasses" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_belt", query: "belt leather men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sportswear", query: "sportswear men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tracksuit", query: "tracksuit" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_nike", query: "nike shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jordan", query: "jordan shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_adidas", query: "adidas shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_puma", query: "puma shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_newbalance", query: "new balance shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_reebok", query: "reebok shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_converse", query: "converse shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_vans", query: "vans shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_underarmour", query: "under armour" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_levis", query: "levi's jeans" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tommy", query: "tommy hilfiger" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_calvinklein", query: "calvin klein" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_zara", query: "zara clothing" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_formal", query: "formal suit men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_watch_strap", query: "watch strap band" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_wallet", query: "leather wallet men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_scarf", query: "scarf women" },

  // ════════════════════════════════════════════════════════════════════
  // JEWELRY & WATCHES — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_rolex", query: "rolex watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_omega", query: "omega watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_seiko", query: "seiko watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_casio", query: "casio g-shock watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_citizen", query: "citizen watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_tissot", query: "tissot watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_tag_heuer", query: "tag heuer watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_apple_watch", query: "apple watch", filters: { unifiedSubcategory: "watches" } },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_samsung_watch", query: "samsung galaxy watch", filters: { unifiedSubcategory: "watches" } },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_garmin", query: "garmin watch", filters: { unifiedSubcategory: "watches" } },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_gold_necklace", query: "gold necklace chain" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_diamond_ring", query: "diamond ring" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_gold_bracelet", query: "gold bracelet" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_silver_earrings", query: "silver earrings" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_pearl_necklace", query: "pearl necklace" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_engagement_ring", query: "engagement ring" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_pendant", query: "pendant necklace gold" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_men_bracelet", query: "men bracelet leather" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_anklet", query: "anklet gold silver" },

  // ════════════════════════════════════════════════════════════════════
  // TOYS — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "toys", provider: "ebay", seed_key: "toys_lego", query: "lego set" },
  { category: "toys", provider: "ebay", seed_key: "toys_lego_star_wars", query: "lego star wars" },
  { category: "toys", provider: "ebay", seed_key: "toys_lego_city", query: "lego city" },
  { category: "toys", provider: "ebay", seed_key: "toys_lego_technic", query: "lego technic" },
  { category: "toys", provider: "ebay", seed_key: "toys_barbie", query: "barbie doll" },
  { category: "toys", provider: "ebay", seed_key: "toys_hot_wheels", query: "hot wheels cars" },
  { category: "toys", provider: "ebay", seed_key: "toys_nerf", query: "nerf gun blaster" },
  { category: "toys", provider: "ebay", seed_key: "toys_rc_car", query: "rc car remote control" },
  { category: "toys", provider: "ebay", seed_key: "toys_drone", query: "toy drone kids" },
  { category: "toys", provider: "ebay", seed_key: "toys_board_game", query: "board game family" },
  { category: "toys", provider: "ebay", seed_key: "toys_puzzle", query: "puzzle jigsaw" },
  { category: "toys", provider: "ebay", seed_key: "toys_educational", query: "educational toys kids" },
  { category: "toys", provider: "ebay", seed_key: "toys_action_figure", query: "action figure" },
  { category: "toys", provider: "ebay", seed_key: "toys_playset", query: "playset kids" },
  { category: "toys", provider: "ebay", seed_key: "toys_stuffed_animal", query: "stuffed animal plush" },
  { category: "toys", provider: "ebay", seed_key: "toys_transformer", query: "transformer toy" },
  { category: "toys", provider: "ebay", seed_key: "toys_pokemon", query: "pokemon cards" },
  { category: "toys", provider: "ebay", seed_key: "toys_building_blocks", query: "building blocks kids" },

  // ════════════════════════════════════════════════════════════════════
  // SPORTING GOODS — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_dumbbells", query: "dumbbells weight set" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_treadmill", query: "treadmill exercise" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_bike", query: "mountain bike bicycle" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_soccer", query: "soccer shoes cleats" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_basketball", query: "basketball shoes" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_yoga", query: "yoga mat" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_golf", query: "golf clubs set" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_tennis", query: "tennis racket" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_boxing", query: "boxing gloves" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_gym_bench", query: "weight bench gym" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_resistance_band", query: "resistance bands set" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_kettlebell", query: "kettlebell weight" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_elliptical", query: "elliptical machine" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_camping", query: "camping tent" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_fishing", query: "fishing rod reel" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_skateboard", query: "skateboard complete" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_soccer_ball", query: "soccer ball football" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_helmet", query: "bike helmet" },

  // ════════════════════════════════════════════════════════════════════
  // BEAUTY & HEALTH — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_perfume_men", query: "men perfume cologne" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_perfume_women", query: "women perfume fragrance" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_skincare", query: "skincare set" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_makeup_kit", query: "makeup kit set" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_lipstick", query: "lipstick set" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_foundation", query: "foundation makeup" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_hair_dryer", query: "hair dryer professional" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_straightener", query: "hair straightener flat iron" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_curling_iron", query: "curling iron wand" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_electric_shaver", query: "electric shaver men" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_trimmer", query: "beard trimmer" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_massager", query: "massage gun" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_teeth_whitening", query: "teeth whitening kit" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_face_mask", query: "face mask skincare" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_nail_kit", query: "nail art kit" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_essential_oil", query: "essential oil diffuser" },

  // ════════════════════════════════════════════════════════════════════
  // CAMERAS & PHOTO — ~15 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_canon_dslr", query: "canon dslr camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_nikon_dslr", query: "nikon dslr camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_sony_mirrorless", query: "sony mirrorless camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_sony_a7", query: "sony a7 camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_gopro", query: "gopro hero camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_fujifilm", query: "fujifilm instax camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_drone_dji", query: "dji drone camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_lens_canon", query: "canon lens" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_lens_nikon", query: "nikon lens" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_tripod", query: "camera tripod" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_ring_light", query: "ring light" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_memory_card", query: "sd card memory" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_webcam", query: "webcam hd" },

  // ════════════════════════════════════════════════════════════════════
  // COLLECTIBLES — ~12 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "collectibles", provider: "ebay", seed_key: "collect_coins", query: "collectible coins" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_stamps", query: "collectible stamps" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_sports_cards", query: "sports trading cards" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_pokemon", query: "pokemon cards collection" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_funko", query: "funko pop figure" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_vintage", query: "vintage collectibles" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_antique", query: "antique collectible" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_vinyl", query: "vinyl record" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_comic", query: "comic book" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_art", query: "art print signed" },

  // ════════════════════════════════════════════════════════════════════
  // BUSINESS & INDUSTRIAL — ~12 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "business_industrial", provider: "ebay", seed_key: "business_generator", query: "portable generator" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_compressor", query: "air compressor" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_welder", query: "welding machine" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_printer", query: "industrial printer" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_sewing", query: "sewing machine industrial" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_forklift", query: "forklift pallet jack" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_solar_panel", query: "solar panel commercial" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_cnc", query: "cnc machine" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_3d_printer", query: "3d printer" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_label_printer", query: "label printer" },

  // ════════════════════════════════════════════════════════════════════
  // REFURBISHED — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "refurbished", provider: "ebay", seed_key: "refurb_iphone", query: "refurbished iphone" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_samsung", query: "refurbished samsung galaxy" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_laptop", query: "refurbished laptop" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_macbook", query: "refurbished macbook" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_ipad", query: "refurbished ipad" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_airpods", query: "refurbished airpods" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_ps5", query: "refurbished ps5 console" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_xbox", query: "refurbished xbox" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_monitor", query: "refurbished monitor" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_desktop", query: "refurbished desktop computer" },

  // ════════════════════════════════════════════════════════════════════
  // AMAZON/RAINFOREST SEEDS — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics", provider: "rainforest", seed_key: "amazon_iphone_15", query: "iphone 15 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_iphone_14", query: "iphone 14 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_samsung_s24", query: "samsung galaxy s24", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_pixel", query: "google pixel unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_ps5", query: "playstation 5 console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_xbox", query: "xbox series x", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_nintendo", query: "nintendo switch", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_macbook", query: "macbook pro", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_laptop", query: "laptop computer", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_airpods", query: "airpods pro", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_headphones", query: "wireless headphones", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_ipad", query: "ipad tablet", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "rainforest", seed_key: "amazon_tab", query: "samsung galaxy tab", filters: { unifiedSubcategory: "tablets" } },
  { category: "home_garden", provider: "rainforest", seed_key: "amazon_vacuum", query: "robot vacuum" },
  { category: "home_garden", provider: "rainforest", seed_key: "amazon_airfryer", query: "air fryer" },
  { category: "home_garden", provider: "rainforest", seed_key: "amazon_blender", query: "blender" },
  { category: "home_garden", provider: "rainforest", seed_key: "amazon_instant_pot", query: "instant pot" },
  { category: "clothing_shoes_accessories", provider: "rainforest", seed_key: "amazon_sneakers", query: "sneakers" },
  { category: "clothing_shoes_accessories", provider: "rainforest", seed_key: "amazon_running", query: "running shoes" },
  { category: "sporting_goods", provider: "rainforest", seed_key: "amazon_weights", query: "dumbbells weight set" },
  { category: "toys", provider: "rainforest", seed_key: "amazon_lego", query: "lego set" },
  { category: "beauty_health", provider: "rainforest", seed_key: "amazon_perfume", query: "perfume cologne" },
  { category: "cameras_photo", provider: "rainforest", seed_key: "amazon_camera", query: "digital camera" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  let isAuthorized = false;
  
  if (checkAdminKey(req)) {
    isAuthorized = true;
  }
  
  const authHeader = req.headers.get("authorization");
  if (!isAuthorized && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAuthorized = !!roles;
      }
    }
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse params
  let runBackfill = true;
  let maxSeeds = 50;

  try {
    const body = await req.json().catch(() => ({}));
    runBackfill = body.runBackfill !== false;
    maxSeeds = body.maxSeeds || 50;
  } catch {
    // Use defaults
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();

  const results: Record<string, unknown> = {};

  // Step A: Seed default catalog queries (inline)
  console.log("[BOOTSTRAP] Step A: Seeding default catalog queries...");
  try {
    let seededCount = 0;
    let skippedCount = 0;
    
    for (const seed of DEFAULT_SEEDS) {
      const { error } = await supabase
        .from("catalog_seed_queries")
        .upsert({
          ...seed,
          enabled: true,
          ttl_minutes: 360,
          updated_at: new Date().toISOString(),
        }, { onConflict: "provider,seed_key" });
      
      if (error) {
        console.error(`[BOOTSTRAP] Failed to seed ${seed.seed_key}:`, error.message);
        skippedCount++;
      } else {
        seededCount++;
      }
    }
    
    results.seedCatalog = { seeded: seededCount, skipped: skippedCount, total: DEFAULT_SEEDS.length };
    console.log(`[BOOTSTRAP] Seeded ${seededCount} queries, skipped ${skippedCount}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Seed failed:", msg);
    results.seedCatalog = { error: msg };
  }

  // Step B: Run live refresh
  console.log("[BOOTSTRAP] Step B: Running live refresh...");
  try {
    const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/catalog-refresh-seeded`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "live",
        maxSeeds,
      }),
    });
    const refreshResult = await refreshResponse.json();
    results.refreshCatalog = refreshResult;
    console.log("[BOOTSTRAP] Refresh result: Fetched=", refreshResult.totalFetched || 0, "Upserted=", refreshResult.totalUpserted || 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Refresh failed:", msg);
    results.refreshCatalog = { error: msg };
  }

  // Step C: Backfill unified_category for existing items (NEVER DELETE)
  if (runBackfill) {
    console.log("[BOOTSTRAP] Step C: Backfilling unified_category (never delete)...");
    try {
      const { data: itemsToBackfill, error: fetchError } = await supabase
        .from("catalog_items")
        .select("id, title, provider, product_url, metadata, unified_category, listing_type")
        .or("unified_category.is.null,listing_type.is.null")
        .limit(2000);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      let backfillCount = 0;

      if (itemsToBackfill && itemsToBackfill.length > 0) {
        for (const item of itemsToBackfill) {
          const { category, subcategory } = mapCategoryAndSubcategory({
            title: item.title || undefined,
            provider: item.provider || undefined,
            productUrl: item.product_url || undefined,
            ebayCategoryPath: (item.metadata as Record<string, unknown>)?.categoryPath as string || undefined,
          });

          // NEVER DELETE — just set is_active=false for blocked items
          if (category === "blocked") {
            await supabase.from("catalog_items").update({
              is_active: false,
              status_reason: "content_blocked",
            }).eq("id", item.id);
          } else {
            let listingType: string | null = null;
            let vehiclesSubkey: string | null = null;
            let partsSubkey: string | null = null;
            
            if (category === "vehicles") {
              listingType = "vehicle";
              vehiclesSubkey = subcategory || "cars_trucks";
            } else if (category === "parts_accessories") {
              listingType = "part";
              partsSubkey = subcategory || "all_parts";
            }

            await supabase
              .from("catalog_items")
              .update({ 
                unified_category: category, 
                unified_subcategory: subcategory,
                listing_type: listingType,
                vehicles_subkey: vehiclesSubkey,
                parts_subkey: partsSubkey,
                updated_at: new Date().toISOString(),
              })
              .eq("id", item.id);
            backfillCount++;
          }
        }
      }

      results.backfill = {
        processed: itemsToBackfill?.length || 0,
        updated: backfillCount,
      };
      console.log(`[BOOTSTRAP] Backfill: Updated=${backfillCount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[BOOTSTRAP] Backfill failed:", msg);
      results.backfill = { error: msg };
    }
  }

  // Get final counts
  const { count: totalItems } = await supabase
    .from("catalog_items")
    .select("*", { count: "exact", head: true });

  const { data: categoryCounts } = await supabase
    .from("catalog_items")
    .select("unified_category")
    .eq("is_active", true)
    .not("unified_category", "is", null);

  const byCategory: Record<string, number> = {};
  if (categoryCounts) {
    for (const row of categoryCounts) {
      const cat = row.unified_category as string;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[BOOTSTRAP] Complete. Total items: ${totalItems} Duration: ${durationMs}ms`);
  console.log(`[BOOTSTRAP] Category breakdown:`, byCategory);

  return new Response(
    JSON.stringify({
      status: "success",
      message: `Catalog bootstrap complete — ${DEFAULT_SEEDS.length} seeds configured`,
      totalItems: totalItems || 0,
      categories: byCategory,
      inserted: (results.refreshCatalog as Record<string, unknown>)?.totalUpserted || 0,
      updated: (results.backfill as Record<string, unknown>)?.updated || 0,
      durationMs,
      steps: results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
