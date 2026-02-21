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
  // 1. x-admin-key or x-cron-secret header
  const adminKey = req.headers.get("x-admin-key");
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedKey = Deno.env.get("CRON_SECRET");
  if (expectedKey && (adminKey === expectedKey || cronSecret === expectedKey)) return true;
  // 2. Service role key only (for manual admin debugging)
  const auth = req.headers.get("authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;
  // NEVER accept anon key — it's public
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASSIVE SEED LIBRARY — Target: 50-200 seeds per category for 2k-6k items
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SEEDS = [
  // ════════════════════════════════════════════════════════════════════
  // PHONES (electronics_phones) — ~40 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_15", query: "iphone 15 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_15_pro", query: "iphone 15 pro max unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_14", query: "iphone 14 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_14_pro", query: "iphone 14 pro max" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_13", query: "iphone 13 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_13_pro", query: "iphone 13 pro max" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_12", query: "iphone 12 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_se", query: "iphone se unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_iphone_pro", query: "iphone pro max unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_s24", query: "samsung galaxy s24 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_s24_ultra", query: "samsung galaxy s24 ultra" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_s23", query: "samsung galaxy s23 unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_s23_ultra", query: "samsung galaxy s23 ultra" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_a54", query: "samsung galaxy a54" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_a34", query: "samsung galaxy a34" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_a15", query: "samsung galaxy a15" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_a25", query: "samsung galaxy a25" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_m14", query: "samsung galaxy m14" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_galaxy", query: "samsung galaxy unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_zfold", query: "samsung galaxy z fold" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_samsung_zflip", query: "samsung galaxy z flip" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_tecno_camon", query: "tecno camon" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_tecno_spark", query: "tecno spark" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_tecno_pova", query: "tecno pova" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_infinix_hot", query: "infinix hot" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_infinix_note", query: "infinix note" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_infinix_zero", query: "infinix zero" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_itel", query: "itel phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_pixel", query: "google pixel unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_pixel_8", query: "google pixel 8 pro" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_oneplus", query: "oneplus phone unlocked" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_oneplus_12", query: "oneplus 12" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_xiaomi_redmi", query: "xiaomi redmi note" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_xiaomi_poco", query: "xiaomi poco phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_motorola", query: "motorola moto phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_oppo", query: "oppo phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_realme", query: "realme phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_huawei", query: "huawei phone" },
  { category: "electronics_phones", provider: "ebay", seed_key: "phones_nothing", query: "nothing phone" },

  // ════════════════════════════════════════════════════════════════════
  // GAMING (electronics_gaming) — ~30 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5", query: "ps5 console playstation 5" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5_slim", query: "ps5 slim console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5_digital", query: "ps5 digital edition console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5_bundle", query: "ps5 console bundle" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps4", query: "ps4 console playstation 4" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps4_pro", query: "ps4 pro console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_xbox_x", query: "xbox series x console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_xbox_s", query: "xbox series s console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_xbox_one", query: "xbox one console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_nintendo", query: "nintendo switch console" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_oled", query: "nintendo switch oled" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_switch_lite", query: "nintendo switch lite" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_vr", query: "meta quest vr headset" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_quest_3", query: "meta quest 3" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_psvr", query: "playstation vr2" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_steam_deck", query: "steam deck handheld" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_rog_ally", query: "rog ally handheld" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5_controller", query: "ps5 dualsense controller" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_xbox_controller", query: "xbox wireless controller" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_pro_controller", query: "nintendo pro controller" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_scuf", query: "scuf controller" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_ps5_games", query: "ps5 games lot" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_xbox_games", query: "xbox series games" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_switch_games", query: "nintendo switch games" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_headset", query: "gaming headset ps5 xbox" },
  { category: "electronics_gaming", provider: "ebay", seed_key: "gaming_retro", query: "retro gaming console" },

  // ════════════════════════════════════════════════════════════════════
  // AUDIO (electronics_audio) — ~25 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_airpods", query: "airpods pro" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_airpods_max", query: "airpods max" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_headphones_wireless", query: "wireless headphones bluetooth" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_jbl_speaker", query: "jbl bluetooth speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_jbl_flip", query: "jbl flip speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_jbl_charge", query: "jbl charge speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_sony_wh", query: "sony wh-1000xm headphones" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_sony_earbuds", query: "sony wf earbuds" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_bose_speaker", query: "bose bluetooth speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_bose_headphones", query: "bose quietcomfort headphones" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_beats", query: "beats headphones wireless" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_beats_studio", query: "beats studio buds" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_soundbar", query: "soundbar home theater" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_samsung_soundbar", query: "samsung soundbar" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_sonos", query: "sonos speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_marshall", query: "marshall speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_earbuds", query: "wireless earbuds" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_sennheiser", query: "sennheiser headphones" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_noise_cancel", query: "noise cancelling headphones" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_studio_monitor", query: "studio monitor speakers" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_portable", query: "portable bluetooth speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_harman_kardon", query: "harman kardon speaker" },
  { category: "electronics_audio", provider: "ebay", seed_key: "audio_subwoofer", query: "subwoofer home audio" },

  // ════════════════════════════════════════════════════════════════════
  // TABLETS (electronics_tablets) — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_ipad_pro", query: "ipad pro" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_ipad_air", query: "ipad air" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_ipad_mini", query: "ipad mini" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_ipad_10th", query: "ipad 10th generation" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_samsung_tab_s9", query: "samsung galaxy tab s9" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_samsung_tab_a", query: "samsung galaxy tab a" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_fire_hd", query: "amazon fire hd tablet" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_lenovo", query: "lenovo tab tablet" },
  { category: "electronics_tablets", provider: "ebay", seed_key: "tablets_surface_pro", query: "microsoft surface pro" },

  // ════════════════════════════════════════════════════════════════════
  // COMPUTERS (electronics_computers) — ~12 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_macbook_pro", query: "macbook pro laptop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_macbook_air", query: "macbook air laptop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_macbook_m3", query: "macbook m3" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_dell_xps", query: "dell xps laptop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_hp_laptop", query: "hp laptop computer" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_lenovo_thinkpad", query: "lenovo thinkpad" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_asus_laptop", query: "asus laptop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_chromebook", query: "chromebook laptop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_desktop", query: "desktop computer pc" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_imac", query: "imac apple desktop" },
  { category: "electronics_computers", provider: "ebay", seed_key: "computers_mini_pc", query: "mini pc desktop" },

  // ════════════════════════════════════════════════════════════════════
  // MONITORS (electronics_monitors) — ~6 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_gaming", query: "gaming monitor 27 inch" },
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_4k", query: "4k monitor" },
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_ultrawide", query: "ultrawide monitor" },
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_lg", query: "lg monitor" },
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_samsung", query: "samsung monitor" },
  { category: "electronics_monitors", provider: "ebay", seed_key: "monitors_dell", query: "dell monitor" },

  // ════════════════════════════════════════════════════════════════════
  // VEHICLES — ~25 seeds (keep as-is, already granular)
  // ════════════════════════════════════════════════════════════════════
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_toyota_camry", query: "toyota camry car", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_civic", query: "honda civic sedan", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "floor mat", "tire", "rim", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_accord", query: "honda accord", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_ford_f150", query: "ford f150 truck", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_ford_explorer", query: "ford explorer suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_bmw_3", query: "bmw 3 series sedan", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_bmw_x5", query: "bmw x5 suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_mercedes_c", query: "mercedes c class", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_mercedes_gle", query: "mercedes gle suv", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_suv_4x4", query: "SUV 4x4 vehicle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_tesla_model_3", query: "tesla model 3", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 5000, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "charger", "adapter"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_tesla_model_y", query: "tesla model y", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 5000, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage", "charger", "adapter"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_toyota_rav4", query: "toyota rav4", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_nissan_altima", query: "nissan altima", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_chevy_silverado", query: "chevrolet silverado truck", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "cars_trucks", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_harley", query: "harley davidson motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage", "helmet", "jacket"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_honda_moto", query: "honda motorcycle cruiser", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_kawasaki", query: "kawasaki motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_yamaha_moto", query: "yamaha motorcycle", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "motorcycles", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_atv", query: "ATV four wheeler", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "powersports", excludeKeywords: ["parts", "repair", "salvage"] } },
  { category: "vehicles", provider: "ebay", seed_key: "vehicles_utv", query: "UTV side by side", filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, listingType: "vehicle", vehiclesSubkey: "powersports", excludeKeywords: ["parts", "repair", "salvage"] } },

  // ════════════════════════════════════════════════════════════════════
  // WEARABLES (electronics_wearables) — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_apple_watch", query: "apple watch" },
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_aw_ultra", query: "apple watch ultra" },
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_aw_se", query: "apple watch se" },
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_samsung_watch", query: "samsung galaxy watch" },
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_fitbit", query: "fitbit smartwatch" },
  { category: "electronics_wearables", provider: "ebay", seed_key: "wearables_garmin", query: "garmin smartwatch" },

  // ════════════════════════════════════════════════════════════════════
  // TV (electronics_tv) — ~8 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_samsung_4k", query: "samsung 4k smart tv" },
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_lg_oled", query: "lg oled tv" },
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_sony_bravia", query: "sony bravia tv" },
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_tcl", query: "tcl roku tv" },
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_hisense", query: "hisense smart tv" },
  { category: "electronics_tv", provider: "ebay", seed_key: "tv_projector", query: "home projector 4k" },

  // ════════════════════════════════════════════════════════════════════
  // HOME & GARDEN — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "home_garden", provider: "ebay", seed_key: "home_vacuum", query: "robot vacuum cleaner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_dyson", query: "dyson vacuum" },
  { category: "home_garden", provider: "ebay", seed_key: "home_airfryer", query: "air fryer" },
  { category: "home_garden", provider: "ebay", seed_key: "home_blender", query: "blender vitamix" },
  { category: "home_garden", provider: "ebay", seed_key: "home_coffee", query: "coffee maker machine" },
  { category: "home_garden", provider: "ebay", seed_key: "home_nespresso", query: "nespresso machine" },
  { category: "home_garden", provider: "ebay", seed_key: "home_microwave", query: "microwave oven" },
  { category: "home_garden", provider: "ebay", seed_key: "home_pressure", query: "instant pot pressure cooker" },
  { category: "home_garden", provider: "ebay", seed_key: "home_iron", query: "steam iron" },
  { category: "home_garden", provider: "ebay", seed_key: "home_fan", query: "tower fan" },
  { category: "home_garden", provider: "ebay", seed_key: "home_ac", query: "portable air conditioner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_heater", query: "space heater" },
  { category: "home_garden", provider: "ebay", seed_key: "home_fridge", query: "mini fridge refrigerator" },
  { category: "home_garden", provider: "ebay", seed_key: "home_mattress", query: "mattress queen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_bedding", query: "bedding set comforter" },
  { category: "home_garden", provider: "ebay", seed_key: "home_solar", query: "solar panel kit" },
  { category: "home_garden", provider: "ebay", seed_key: "home_generator", query: "portable generator" },
  { category: "home_garden", provider: "ebay", seed_key: "home_tools", query: "power tools drill set" },
  { category: "home_garden", provider: "ebay", seed_key: "home_water", query: "water purifier filter" },

  // ════════════════════════════════════════════════════════════════════
  // CLOTHING & ACCESSORIES — ~20 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_nike_shoes", query: "nike shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_adidas", query: "adidas sneakers" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jordan", query: "air jordan shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_new_balance", query: "new balance shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_dress_women", query: "women dress" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jacket_men", query: "men jacket" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_handbag", query: "designer handbag" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_backpack", query: "backpack" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sunglasses", query: "designer sunglasses" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_boots", query: "boots women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sandals", query: "sandals women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_african", query: "african clothing traditional" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_ankara", query: "ankara fabric african" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_wax", query: "wax print fabric" },

  // ════════════════════════════════════════════════════════════════════
  // TOYS — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "toys", provider: "ebay", seed_key: "toys_lego", query: "lego set" },
  { category: "toys", provider: "ebay", seed_key: "toys_drone", query: "drone camera" },
  { category: "toys", provider: "ebay", seed_key: "toys_rc_car", query: "rc car remote control" },
  { category: "toys", provider: "ebay", seed_key: "toys_action_figure", query: "action figure collectible" },
  { category: "toys", provider: "ebay", seed_key: "toys_board_game", query: "board game" },
  { category: "toys", provider: "ebay", seed_key: "toys_barbie", query: "barbie doll" },
  { category: "toys", provider: "ebay", seed_key: "toys_hot_wheels", query: "hot wheels" },
  { category: "toys", provider: "ebay", seed_key: "toys_nerf", query: "nerf gun" },

  // ════════════════════════════════════════════════════════════════════
  // SPORTING GOODS — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_weights", query: "dumbbells weight set" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_treadmill", query: "treadmill" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_bike", query: "mountain bike" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_basketball", query: "basketball shoes" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_football", query: "football soccer ball" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_yoga", query: "yoga mat" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_camping", query: "camping tent" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_fishing", query: "fishing rod reel" },

  // ════════════════════════════════════════════════════════════════════
  // JEWELRY & WATCHES — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_gold_chain", query: "gold chain necklace" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_diamond", query: "diamond ring" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_rolex", query: "rolex watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_casio", query: "casio g-shock watch" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_silver", query: "silver bracelet" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_earrings", query: "gold earrings" },

  // ════════════════════════════════════════════════════════════════════
  // PARTS & ACCESSORIES — ~10 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_phone_case", query: "phone case iphone" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_charger", query: "usb c charger fast" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_screen", query: "screen protector" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_cable", query: "hdmi cable" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_car_parts", query: "car parts auto" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_led_lights", query: "led strip lights" },
  { category: "parts_accessories", provider: "ebay", seed_key: "parts_battery", query: "portable battery charger" },

  // ════════════════════════════════════════════════════════════════════
  // BEAUTY & HEALTH — ~8 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_perfume", query: "perfume cologne" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_skincare", query: "skincare set" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_hair", query: "hair extensions" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_makeup", query: "makeup set" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_wig", query: "human hair wig" },
  { category: "beauty_health", provider: "ebay", seed_key: "beauty_electric_shaver", query: "electric shaver trimmer" },

  // ════════════════════════════════════════════════════════════════════
  // CAMERAS & PHOTO — ~6 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_canon", query: "canon eos camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_nikon", query: "nikon camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_sony_alpha", query: "sony alpha camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_gopro", query: "gopro camera" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_instax", query: "fujifilm instax" },
  { category: "cameras_photo", provider: "ebay", seed_key: "cameras_action", query: "action camera 4k" },

  // ════════════════════════════════════════════════════════════════════
  // COLLECTIBLES — ~5 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "collectibles", provider: "ebay", seed_key: "collect_pokemon", query: "pokemon cards" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_coins", query: "gold coins" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_sports", query: "sports cards" },
  { category: "collectibles", provider: "ebay", seed_key: "collect_funko", query: "funko pop" },

  // ════════════════════════════════════════════════════════════════════
  // REFURBISHED — ~6 seeds
  // ════════════════════════════════════════════════════════════════════
  { category: "refurbished", provider: "ebay", seed_key: "refurb_iphone", query: "refurbished iphone" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_macbook", query: "refurbished macbook" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_ipad", query: "refurbished ipad" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_samsung", query: "refurbished samsung galaxy" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_monitor", query: "refurbished monitor" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_desktop", query: "refurbished desktop computer" },

  // ════════════════════════════════════════════════════════════════════
  // AMAZON/RAINFOREST SEEDS — granular categories
  // ════════════════════════════════════════════════════════════════════
  { category: "electronics_phones", provider: "rainforest", seed_key: "amazon_iphone_15", query: "iphone 15 unlocked" },
  { category: "electronics_phones", provider: "rainforest", seed_key: "amazon_iphone_14", query: "iphone 14 unlocked" },
  { category: "electronics_phones", provider: "rainforest", seed_key: "amazon_samsung_s24", query: "samsung galaxy s24" },
  { category: "electronics_phones", provider: "rainforest", seed_key: "amazon_pixel", query: "google pixel unlocked" },
  { category: "electronics_gaming", provider: "rainforest", seed_key: "amazon_ps5", query: "playstation 5 console" },
  { category: "electronics_gaming", provider: "rainforest", seed_key: "amazon_xbox", query: "xbox series x" },
  { category: "electronics_gaming", provider: "rainforest", seed_key: "amazon_nintendo", query: "nintendo switch" },
  { category: "electronics_computers", provider: "rainforest", seed_key: "amazon_macbook", query: "macbook pro" },
  { category: "electronics_computers", provider: "rainforest", seed_key: "amazon_laptop", query: "laptop computer" },
  { category: "electronics_audio", provider: "rainforest", seed_key: "amazon_airpods", query: "airpods pro" },
  { category: "electronics_audio", provider: "rainforest", seed_key: "amazon_headphones", query: "wireless headphones" },
  { category: "electronics_tablets", provider: "rainforest", seed_key: "amazon_ipad", query: "ipad tablet" },
  { category: "electronics_tablets", provider: "rainforest", seed_key: "amazon_tab", query: "samsung galaxy tab" },
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
