/**
 * Amazon Ingest Worker — THE ONLY function that calls Rainforest/Amazon live API
 * 
 * Triggered by pg_cron. Processes the amazon_ingest_queue first (up to 10),
 * then seeds 30 high-demand queries across all categories per run.
 * 
 * Budget gates: 50/hour + 10,000/month hard cap.
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 */

import { createClient } from "@supabase/supabase-js";
import { searchRainforest, fetchProductDetails } from "../_shared/rainforestAdapter.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";
import { sanitizeGallery, sanitizeImageUrl } from "../_shared/imageValidator.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── CONGO/DRC HIGH-DEMAND SEED QUERIES ──────────────────────────────────────

const AMAZON_CONGO_SEEDS: Array<{ query: string; category_key: string; priority: number }> = [
  // ─── PHONES (TOP priority) ─────────────────────────────────────────
  { query: "iphone 17 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 17 pro max unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 16 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 16 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 15 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 15 pro max unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 14 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 14 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 13 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 13 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 12 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "renewed iphone unlocked", category_key: "electronics_phones", priority: 2 },
  { query: "refurbished iphone unlocked", category_key: "electronics_phones", priority: 2 },
  { query: "samsung galaxy a15 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "samsung galaxy a25 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "samsung galaxy s24 ultra unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "samsung galaxy s25 unlocked", category_key: "electronics_phones", priority: 2 },
  { query: "tecno spark unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "infinix hot unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "dual sim unlocked smartphone", category_key: "electronics_phones", priority: 3 },
  { query: "google pixel 9 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "oneplus 12 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "motorola razr unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "xiaomi redmi note unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "phone case iphone 16", category_key: "electronics_phones", priority: 4 },
  { query: "screen protector iphone 15", category_key: "electronics_phones", priority: 4 },
  { query: "wireless earbuds bluetooth", category_key: "electronics_audio", priority: 3 },

  // ─── POWER & CHARGING ──────────────────────────────────────────────
  { query: "power bank 20000mah fast charging", category_key: "electronics", priority: 2 },
  { query: "power bank 10000mah slim", category_key: "electronics", priority: 3 },
  { query: "usb c charger 25w", category_key: "electronics", priority: 3 },
  { query: "solar lantern rechargeable", category_key: "electronics", priority: 3 },
  { query: "rechargeable led bulb e27", category_key: "electronics", priority: 3 },
  { query: "surge protector heavy duty", category_key: "electronics", priority: 3 },
  { query: "portable solar panel charger", category_key: "electronics", priority: 3 },
  { query: "usb c fast charging cable", category_key: "electronics", priority: 4 },

  // ─── NETWORKING & INTERNET ─────────────────────────────────────────
  { query: "tp link router", category_key: "electronics", priority: 3 },
  { query: "4g lte hotspot unlocked", category_key: "electronics", priority: 3 },
  { query: "wifi extender", category_key: "electronics", priority: 3 },
  { query: "wifi 6 router", category_key: "electronics", priority: 4 },
  { query: "ethernet cable cat6", category_key: "electronics", priority: 4 },

  // ─── COMPUTERS & LAPTOPS ───────────────────────────────────────────
  { query: "lenovo thinkpad renewed i5", category_key: "electronics_computers", priority: 3 },
  { query: "dell latitude renewed i5", category_key: "electronics_computers", priority: 3 },
  { query: "hp elitebook renewed", category_key: "electronics_computers", priority: 3 },
  { query: "macbook air m2 renewed", category_key: "electronics_computers", priority: 3 },
  { query: "chromebook laptop", category_key: "electronics_computers", priority: 4 },
  { query: "ssd 1tb", category_key: "electronics_computers", priority: 4 },
  { query: "ddr4 16gb laptop ram", category_key: "electronics_computers", priority: 4 },
  { query: "usb hub multiport adapter", category_key: "electronics_computers", priority: 4 },
  { query: "laptop stand adjustable", category_key: "electronics_computers", priority: 4 },
  { query: "wireless mouse keyboard combo", category_key: "electronics_computers", priority: 4 },
  { query: "webcam 1080p", category_key: "electronics_computers", priority: 4 },
  { query: "monitor 24 inch 1080p", category_key: "electronics_computers", priority: 4 },

  // ─── GAMING ────────────────────────────────────────────────────────
  { query: "ps5 console", category_key: "electronics_gaming", priority: 2 },
  { query: "ps5 controller dualsense", category_key: "electronics_gaming", priority: 3 },
  { query: "xbox series x", category_key: "electronics_gaming", priority: 2 },
  { query: "xbox wireless controller", category_key: "electronics_gaming", priority: 3 },
  { query: "nintendo switch oled", category_key: "electronics_gaming", priority: 2 },
  { query: "gaming headset wireless", category_key: "electronics_gaming", priority: 3 },
  { query: "gaming keyboard mechanical rgb", category_key: "electronics_gaming", priority: 4 },
  { query: "gaming mouse wireless", category_key: "electronics_gaming", priority: 4 },
  { query: "ps5 games 2025", category_key: "electronics_gaming", priority: 3 },
  { query: "nintendo switch games", category_key: "electronics_gaming", priority: 3 },
  { query: "gaming monitor 27 inch 144hz", category_key: "electronics_gaming", priority: 4 },

  // ─── AUDIO & HEADPHONES ────────────────────────────────────────────
  { query: "airpods pro 2", category_key: "electronics_audio", priority: 2 },
  { query: "samsung galaxy buds", category_key: "electronics_audio", priority: 3 },
  { query: "jbl bluetooth speaker", category_key: "electronics_audio", priority: 3 },
  { query: "sony wh-1000xm5 headphones", category_key: "electronics_audio", priority: 3 },
  { query: "bluetooth speaker waterproof", category_key: "electronics_audio", priority: 3 },
  { query: "noise cancelling headphones", category_key: "electronics_audio", priority: 3 },
  { query: "portable bluetooth speaker", category_key: "electronics_audio", priority: 4 },

  // ─── CAMERAS & PHOTOGRAPHY ─────────────────────────────────────────
  { query: "gopro hero 13", category_key: "electronics_cameras", priority: 3 },
  { query: "canon eos rebel camera", category_key: "electronics_cameras", priority: 3 },
  { query: "ring doorbell camera", category_key: "electronics_cameras", priority: 3 },
  { query: "security camera outdoor wireless", category_key: "electronics_cameras", priority: 3 },
  { query: "dash cam 4k", category_key: "electronics_cameras", priority: 4 },
  { query: "drone camera 4k", category_key: "electronics_cameras", priority: 3 },
  { query: "instant camera fujifilm", category_key: "electronics_cameras", priority: 4 },

  // ─── FASHION — SNEAKERS & SHOES ────────────────────────────────────
  { query: "nike air max mens", category_key: "fashion_shoes", priority: 2 },
  { query: "nike air force 1", category_key: "fashion_shoes", priority: 2 },
  { query: "adidas ultraboost", category_key: "fashion_shoes", priority: 2 },
  { query: "jordan 1 retro", category_key: "fashion_shoes", priority: 2 },
  { query: "new balance 550", category_key: "fashion_shoes", priority: 3 },
  { query: "puma suede classic", category_key: "fashion_shoes", priority: 3 },
  { query: "crocs classic clog", category_key: "fashion_shoes", priority: 3 },
  { query: "mens dress shoes", category_key: "fashion_shoes", priority: 4 },
  { query: "women sneakers running", category_key: "fashion_shoes", priority: 3 },
  { query: "sandals women comfortable", category_key: "fashion_shoes", priority: 4 },
  { query: "timberland boots mens", category_key: "fashion_shoes", priority: 3 },

  // ─── FASHION — CLOTHING ────────────────────────────────────────────
  { query: "mens polo shirt", category_key: "fashion_clothing", priority: 3 },
  { query: "womens summer dresses", category_key: "fashion_clothing", priority: 3 },
  { query: "african print dress", category_key: "fashion_clothing", priority: 2 },
  { query: "ankara fabric", category_key: "fashion_clothing", priority: 2 },
  { query: "mens jeans slim fit", category_key: "fashion_clothing", priority: 3 },
  { query: "womens jeans high waist", category_key: "fashion_clothing", priority: 3 },
  { query: "nike dri fit shirt", category_key: "fashion_clothing", priority: 3 },
  { query: "adidas tracksuit mens", category_key: "fashion_clothing", priority: 3 },
  { query: "hoodie mens pullover", category_key: "fashion_clothing", priority: 4 },
  { query: "womens bodycon dress", category_key: "fashion_clothing", priority: 4 },
  { query: "dashiki mens shirt", category_key: "fashion_clothing", priority: 3 },
  { query: "mens t shirts pack", category_key: "fashion_clothing", priority: 4 },
  { query: "womens blouse elegant", category_key: "fashion_clothing", priority: 4 },

  // ─── FASHION — ACCESSORIES & JEWELRY ───────────────────────────────
  { query: "gold chain necklace mens", category_key: "fashion_accessories", priority: 3 },
  { query: "womens handbag leather", category_key: "fashion_accessories", priority: 3 },
  { query: "sunglasses polarized mens", category_key: "fashion_accessories", priority: 3 },
  { query: "apple watch series 10", category_key: "fashion_accessories", priority: 2 },
  { query: "mens watch casual", category_key: "fashion_accessories", priority: 3 },
  { query: "baseball cap fitted", category_key: "fashion_accessories", priority: 4 },
  { query: "crossbody bag women", category_key: "fashion_accessories", priority: 4 },
  { query: "belt mens leather", category_key: "fashion_accessories", priority: 4 },
  { query: "backpack laptop 15 inch", category_key: "fashion_accessories", priority: 3 },
  { query: "duffle bag travel", category_key: "fashion_accessories", priority: 4 },

  // ─── BEAUTY & HAIR ─────────────────────────────────────────────────
  { query: "human hair wigs lace front", category_key: "beauty", priority: 2 },
  { query: "hair extensions clip in", category_key: "beauty", priority: 2 },
  { query: "braiding hair kanekalon", category_key: "beauty", priority: 2 },
  { query: "lace front wig body wave", category_key: "beauty", priority: 2 },
  { query: "hair growth oil", category_key: "beauty", priority: 3 },
  { query: "shea butter pure", category_key: "beauty", priority: 3 },
  { query: "african black soap", category_key: "beauty", priority: 3 },
  { query: "perfume for women long lasting", category_key: "beauty", priority: 3 },
  { query: "cologne men designer", category_key: "beauty", priority: 3 },
  { query: "makeup set complete", category_key: "beauty", priority: 3 },
  { query: "skincare set women", category_key: "beauty", priority: 3 },
  { query: "nail polish gel set", category_key: "beauty", priority: 4 },
  { query: "flat iron hair straightener", category_key: "beauty", priority: 3 },
  { query: "electric hair clipper professional", category_key: "beauty", priority: 3 },
  { query: "curling iron", category_key: "beauty", priority: 4 },
  { query: "cocoa butter lotion", category_key: "beauty", priority: 4 },
  { query: "teeth whitening kit", category_key: "beauty", priority: 4 },

  // ─── HOME & KITCHEN ────────────────────────────────────────────────
  { query: "nonstick cookware set", category_key: "home_kitchen", priority: 3 },
  { query: "pressure cooker stainless steel", category_key: "home_kitchen", priority: 3 },
  { query: "bedding set queen", category_key: "home_kitchen", priority: 3 },
  { query: "curtains blackout", category_key: "home_kitchen", priority: 4 },
  { query: "throw pillows decorative", category_key: "home_kitchen", priority: 4 },
  { query: "kitchen knife set", category_key: "home_kitchen", priority: 3 },
  { query: "storage containers food", category_key: "home_kitchen", priority: 4 },
  { query: "bathroom accessories set", category_key: "home_kitchen", priority: 4 },
  { query: "area rug living room", category_key: "home_kitchen", priority: 4 },
  { query: "wall art canvas", category_key: "home_kitchen", priority: 4 },
  { query: "led strip lights bedroom", category_key: "home_kitchen", priority: 3 },
  { query: "door mat outdoor", category_key: "home_kitchen", priority: 4 },
  { query: "shower head high pressure", category_key: "home_kitchen", priority: 4 },
  { query: "air freshener plug in", category_key: "home_kitchen", priority: 4 },
  { query: "cleaning supplies kit", category_key: "home_kitchen", priority: 4 },
  { query: "vacuum cleaner cordless", category_key: "home_kitchen", priority: 3 },

  // ─── APPLIANCES ────────────────────────────────────────────────────
  { query: "blender portable usb", category_key: "appliances", priority: 3 },
  { query: "rice cooker 6 cup", category_key: "appliances", priority: 3 },
  { query: "steam iron clothes", category_key: "appliances", priority: 3 },
  { query: "standing fan oscillating", category_key: "appliances", priority: 3 },
  { query: "air fryer large capacity", category_key: "appliances", priority: 3 },
  { query: "microwave oven countertop", category_key: "appliances", priority: 3 },
  { query: "electric kettle stainless", category_key: "appliances", priority: 3 },
  { query: "toaster oven", category_key: "appliances", priority: 4 },
  { query: "coffee maker drip", category_key: "appliances", priority: 4 },
  { query: "mini fridge compact", category_key: "appliances", priority: 3 },
  { query: "water dispenser countertop", category_key: "appliances", priority: 3 },
  { query: "sewing machine portable", category_key: "appliances", priority: 4 },
  { query: "deep fryer electric", category_key: "appliances", priority: 4 },
  { query: "instant pot duo", category_key: "appliances", priority: 3 },

  // ─── KIDS & BABY ───────────────────────────────────────────────────
  { query: "pampers diapers size 4", category_key: "kids_baby", priority: 2 },
  { query: "huggies diapers newborn", category_key: "kids_baby", priority: 2 },
  { query: "baby clothes newborn set", category_key: "kids_baby", priority: 3 },
  { query: "baby stroller lightweight", category_key: "kids_baby", priority: 3 },
  { query: "baby carrier wrap", category_key: "kids_baby", priority: 3 },
  { query: "toddler toys educational", category_key: "kids_baby", priority: 3 },
  { query: "lego sets kids", category_key: "kids_baby", priority: 3 },
  { query: "baby formula similac", category_key: "kids_baby", priority: 2 },
  { query: "kids school backpack", category_key: "kids_baby", priority: 3 },
  { query: "school supplies kit", category_key: "kids_baby", priority: 3 },
  { query: "baby bottles set", category_key: "kids_baby", priority: 4 },
  { query: "kids shoes sneakers", category_key: "kids_baby", priority: 3 },
  { query: "kids tablet learning", category_key: "kids_baby", priority: 3 },
  { query: "baby monitor camera wifi", category_key: "kids_baby", priority: 3 },
  { query: "crib mattress waterproof", category_key: "kids_baby", priority: 4 },

  // ─── HEALTH & WELLNESS ─────────────────────────────────────────────
  { query: "multivitamin men daily", category_key: "health", priority: 3 },
  { query: "multivitamin women", category_key: "health", priority: 3 },
  { query: "vitamin d3 5000 iu", category_key: "health", priority: 3 },
  { query: "omega 3 fish oil", category_key: "health", priority: 3 },
  { query: "first aid kit complete", category_key: "health", priority: 3 },
  { query: "blood pressure monitor", category_key: "health", priority: 3 },
  { query: "digital thermometer", category_key: "health", priority: 4 },
  { query: "protein powder whey", category_key: "health", priority: 3 },
  { query: "resistance bands set", category_key: "health", priority: 4 },
  { query: "yoga mat thick", category_key: "health", priority: 4 },
  { query: "electric toothbrush", category_key: "health", priority: 4 },
  { query: "mosquito repellent spray", category_key: "health", priority: 3 },
  { query: "hand sanitizer bulk", category_key: "health", priority: 4 },

  // ─── AUTO & CAR ACCESSORIES ────────────────────────────────────────
  { query: "car phone mount magnetic", category_key: "auto", priority: 3 },
  { query: "car led headlight bulbs", category_key: "auto", priority: 3 },
  { query: "car seat covers full set", category_key: "auto", priority: 3 },
  { query: "tire inflator portable", category_key: "auto", priority: 3 },
  { query: "car dash cam front rear", category_key: "auto", priority: 3 },
  { query: "car bluetooth fm transmitter", category_key: "auto", priority: 3 },
  { query: "car vacuum cleaner portable", category_key: "auto", priority: 4 },
  { query: "car floor mats universal", category_key: "auto", priority: 4 },
  { query: "jump starter portable", category_key: "auto", priority: 3 },
  { query: "car air freshener", category_key: "auto", priority: 4 },
  { query: "car wash kit complete", category_key: "auto", priority: 4 },
  { query: "steering wheel cover leather", category_key: "auto", priority: 4 },

  // ─── SPORTS & OUTDOORS ─────────────────────────────────────────────
  { query: "soccer ball size 5", category_key: "sports", priority: 3 },
  { query: "basketball official size", category_key: "sports", priority: 3 },
  { query: "dumbbell set adjustable", category_key: "sports", priority: 3 },
  { query: "camping tent 4 person", category_key: "sports", priority: 3 },
  { query: "hiking backpack 50l", category_key: "sports", priority: 4 },
  { query: "water bottle insulated", category_key: "sports", priority: 4 },
  { query: "running shoes men", category_key: "sports", priority: 3 },
  { query: "gym bag sports", category_key: "sports", priority: 4 },
  { query: "bicycle accessories kit", category_key: "sports", priority: 4 },
  { query: "fishing rod and reel combo", category_key: "sports", priority: 4 },

  // ─── TOOLS & HARDWARE ──────────────────────────────────────────────
  { query: "cordless drill dewalt", category_key: "tools", priority: 3 },
  { query: "tool set mechanic", category_key: "tools", priority: 3 },
  { query: "tape measure 25ft", category_key: "tools", priority: 4 },
  { query: "flashlight rechargeable tactical", category_key: "tools", priority: 3 },
  { query: "generator portable", category_key: "tools", priority: 2 },
  { query: "solar generator portable", category_key: "tools", priority: 2 },
  { query: "inverter 12v to 220v", category_key: "tools", priority: 3 },
  { query: "padlock heavy duty", category_key: "tools", priority: 4 },
  { query: "extension cord heavy duty", category_key: "tools", priority: 4 },

  // ─── OFFICE & SCHOOL SUPPLIES ──────────────────────────────────────
  { query: "calculator scientific", category_key: "office", priority: 4 },
  { query: "printer ink cartridges hp", category_key: "office", priority: 4 },
  { query: "notebook college ruled", category_key: "office", priority: 4 },
  { query: "desk organizer", category_key: "office", priority: 4 },
  { query: "whiteboard markers", category_key: "office", priority: 4 },
  { query: "label maker portable", category_key: "office", priority: 4 },

  // ─── GROCERY & FOOD ────────────────────────────────────────────────
  { query: "olive oil extra virgin", category_key: "grocery", priority: 4 },
  { query: "coffee beans whole", category_key: "grocery", priority: 4 },
  { query: "rice basmati 10lb", category_key: "grocery", priority: 4 },
  { query: "snack variety pack", category_key: "grocery", priority: 4 },
  { query: "protein bars box", category_key: "grocery", priority: 4 },
  { query: "tea variety pack", category_key: "grocery", priority: 4 },

  // ─── PET SUPPLIES ──────────────────────────────────────────────────
  { query: "dog food dry adult", category_key: "pets", priority: 4 },
  { query: "cat litter clumping", category_key: "pets", priority: 4 },
  { query: "dog collar adjustable", category_key: "pets", priority: 4 },
  { query: "pet carrier airline approved", category_key: "pets", priority: 4 },
];

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function verifyCronAuth(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const headerSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key") || "";

  if (!headerSecret || !cronSecret) return false;
  return headerSecret === cronSecret;
}

// ─── BUDGET CHECK ─────────────────────────────────────────────────────────────

interface BudgetGate {
  allowed: boolean;
  hourlyRemaining: number;
  monthlyRemaining: number;
}

async function checkDualBudget(supabase: any, settings: any, requestId: string): Promise<BudgetGate> {
  const [hourly, monthly] = await Promise.all([
    checkBudget(supabase, "amazon", "hour", settings.amazonMaxCallsPerHour, requestId),
    checkBudget(supabase, "amazon", "month", settings.amazonMaxCallsPerMonth, requestId),
  ]);

  return {
    allowed: hourly.allowed && monthly.allowed,
    hourlyRemaining: hourly.remaining,
    monthlyRemaining: monthly.remaining,
  };
}

async function incrementDualBudget(supabase: any, settings: any, requestId: string): Promise<void> {
  await Promise.all([
    incrementBudget(supabase, "amazon", "hour", requestId, settings.amazonMaxCallsPerHour),
    incrementBudget(supabase, "amazon", "month", requestId, settings.amazonMaxCallsPerMonth),
  ]);
}

// ─── PROCESS SINGLE QUEUE ITEM ───────────────────────────────────────────────

async function processQueueItem(
  supabase: any,
  liveClient: any,
  item: { id: number; query: string; category_key: string | null; attempts: number },
  settings: any,
  requestId: string
): Promise<{ success: boolean; itemsIngested: number }> {
  const budget = await checkDualBudget(supabase, settings, requestId);
  if (!budget.allowed) {
    console.log(`[AMAZON_INGEST] budget denied for queue item ${item.id} (hourly=${budget.hourlyRemaining}, monthly=${budget.monthlyRemaining})`);
    return { success: false, itemsIngested: 0 };
  }

  // Mark as processing
  await supabase.from("amazon_ingest_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", item.id);

  try {
    let itemsIngested = 0;

    if (item.query.startsWith("asin:")) {
      // Product detail fetch
      const asin = item.query.replace("asin:", "");
      const { product, error } = await fetchProductDetails(asin, "amazon.com");
      
      await incrementDualBudget(supabase, settings, requestId);

      if (error || !product) {
        throw new Error(error || "Product not found");
      }

      const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
        title: product.title || "", provider: "rainforest", productUrl: product.productUrl || "",
      });

      const galleryImages = sanitizeGallery(product.images?.length > 0 ? product.images : (product.imageUrl ? [product.imageUrl] : []));
      const primaryImage = sanitizeImageUrl(product.imageUrl) ?? galleryImages[0] ?? null;

      await liveClient.from("catalog_items").upsert({
        id: `amazon_${product.providerProductId}`,
        provider: "rainforest",
        provider_product_id: product.providerProductId,
        title: product.title,
        price_usd: product.priceUsd,
        image_url: primaryImage,
        images: galleryImages,
        product_url: product.productUrl,
        in_stock: product.inStock ?? true,
        rating: product.rating,
        brand: product.brand,
        unified_category: mappedCat !== "blocked" ? mappedCat : (item.category_key || "electronics"),
        unified_subcategory: subcategory,
        category_key: item.category_key || "uncategorized",
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

      itemsIngested = 1;
      console.log(`[AMAZON_INGEST] processed ASIN ${asin}, ingested 1 product`);
    } else {
      // Search query
      const result = await searchRainforest(item.query, 1, 20, "amazon.com");
      
      await incrementDualBudget(supabase, settings, requestId);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.products.length > 0) {
        const now = new Date().toISOString();
        const toUpsert = result.products.map(p => {
          const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
            title: p.title || "", provider: "rainforest", productUrl: p.productUrl || "",
          });
          const galleryImages = sanitizeGallery((p.images?.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []));
          const primaryImage = sanitizeImageUrl(p.imageUrl) ?? galleryImages[0] ?? null;
          return {
            id: `amazon_${p.providerProductId}`,
            provider: "rainforest",
            provider_product_id: p.providerProductId,
            title: p.title,
            price_usd: p.priceUsd,
            image_url: primaryImage,
            images: galleryImages,
            product_url: p.productUrl,
            in_stock: p.inStock ?? true,
            rating: p.rating,
            unified_category: mappedCat !== "blocked" ? mappedCat : (item.category_key || "electronics"),
            unified_subcategory: subcategory,
            category_key: item.category_key || "uncategorized",
            updated_at: now,
          };
        });

        await liveClient.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
        itemsIngested = toUpsert.length;
        console.log(`[AMAZON_INGEST] processed query "${item.query}", ingested ${itemsIngested} products`);
      }
    }

    // Mark as done
    await supabase.from("amazon_ingest_queue")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", item.id);

    return { success: true, itemsIngested };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const newAttempts = (item.attempts || 0) + 1;
    const newStatus = newAttempts >= 3 ? "failed" : "queued";

    await supabase.from("amazon_ingest_queue")
      .update({
        status: newStatus,
        attempts: newAttempts,
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    console.error(`[AMAZON_INGEST] error processing queue item ${item.id}: ${errorMsg} (attempt ${newAttempts})`);
    return { success: false, itemsIngested: 0 };
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  if (!verifyCronAuth(req)) {
    console.error("[AMAZON_INGEST] Unauthorized request");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const liveClient = supabase;

  const requestId = `ingest-${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AMAZON_INGEST] Worker started, requestId=${requestId}`);

  const settings = await getCatalogSettings(supabase);

  let totalQueueProcessed = 0;
  let totalSeedsProcessed = 0;
  let totalItemsIngested = 0;
  let budgetDenied = false;

  // ─── PHASE 1: Process queue items (up to 10) ───────────────────────
  const { data: queueItems } = await supabase
    .from("amazon_ingest_queue")
    .select("id, query, category_key, attempts")
    .eq("status", "queued")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10);

  if (queueItems && queueItems.length > 0) {
    console.log(`[AMAZON_INGEST] Processing ${queueItems.length} queue items`);

    for (const item of queueItems) {
      const result = await processQueueItem(supabase, liveClient, item, settings, requestId);
      if (!result.success && result.itemsIngested === 0) {
        // Budget denied — stop processing
        const gate = await checkDualBudget(supabase, settings, requestId);
        if (!gate.allowed) {
          budgetDenied = true;
          console.log(`[AMAZON_INGEST] budget denied, stopping queue processing`);
          break;
        }
      }
      totalQueueProcessed++;
      totalItemsIngested += result.itemsIngested;

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ─── PHASE 2: Seed queries (up to 30, if budget allows) ─────────
  if (!budgetDenied) {
    // Smart rotation: read last seed index + page from admin_settings
    let seedOffset = 0;
    let seedPage = 1;
    const MAX_SEED_PAGE = 5;

    const { data: seedSettings } = await supabase
      .from("admin_settings")
      .select("key, value")
      .in("key", ["amazon_seed_last_index", "amazon_seed_page"]);

    if (seedSettings) {
      for (const row of seedSettings) {
        if (row.key === "amazon_seed_last_index") seedOffset = parseInt(row.value, 10) || 0;
        if (row.key === "amazon_seed_page") seedPage = parseInt(row.value, 10) || 1;
      }
    }

    const SEEDS_PER_RUN = 30;
    const seedsToProcess = [];

    for (let i = 0; i < Math.min(SEEDS_PER_RUN, AMAZON_CONGO_SEEDS.length); i++) {
      const idx = (seedOffset + i) % AMAZON_CONGO_SEEDS.length;
      seedsToProcess.push(AMAZON_CONGO_SEEDS[idx]);
    }

    // Calculate next offset and page rotation
    const nextOffset = (seedOffset + SEEDS_PER_RUN) % AMAZON_CONGO_SEEDS.length;
    // When we wrap around to the beginning, advance to next page
    const wrappedAround = nextOffset < seedOffset;
    let nextPage = wrappedAround ? seedPage + 1 : seedPage;
    if (nextPage > MAX_SEED_PAGE) nextPage = 1; // Reset to page 1 after page 5

    const now = new Date().toISOString();
    await supabase
      .from("admin_settings")
      .upsert([
        { key: "amazon_seed_last_index", value: String(nextOffset), updated_at: now },
        { key: "amazon_seed_page", value: String(nextPage), updated_at: now },
      ], { onConflict: "key" });

    console.log(`[AMAZON_INGEST] Seeding ${seedsToProcess.length} queries, page=${seedPage}, offset=${seedOffset}→${nextOffset}, nextPage=${nextPage}`);

    for (const seed of seedsToProcess) {
      const gate = await checkDualBudget(supabase, settings, requestId);
      if (!gate.allowed) {
        console.log(`[AMAZON_INGEST] budget denied, stopping seed processing (hourly=${gate.hourlyRemaining}, monthly=${gate.monthlyRemaining})`);
        budgetDenied = true;
        break;
      }

      try {
        const result = await searchRainforest(seed.query, seedPage, 20, "amazon.com");
        await incrementDualBudget(supabase, settings, requestId);

        if (!result.error && result.products.length > 0) {
          const now = new Date().toISOString();
          const toUpsert = result.products.map(p => {
            const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
              title: p.title || "", provider: "rainforest", productUrl: p.productUrl || "",
            });
            const galleryImages = sanitizeGallery((p.images?.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []));
            const primaryImage = sanitizeImageUrl(p.imageUrl) ?? galleryImages[0] ?? null;
            return {
              id: `amazon_${p.providerProductId}`,
              provider: "rainforest",
              provider_product_id: p.providerProductId,
              title: p.title,
              price_usd: p.priceUsd,
              image_url: primaryImage,
              images: galleryImages,
              product_url: p.productUrl,
              in_stock: p.inStock ?? true,
              rating: p.rating,
              unified_category: mappedCat !== "blocked" ? mappedCat : seed.category_key,
              unified_subcategory: subcategory,
              category_key: seed.category_key,
              updated_at: now,
            };
          });

          await liveClient.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
          totalItemsIngested += toUpsert.length;
          console.log(`[AMAZON_INGEST] seeded query "${seed.query}", ingested ${toUpsert.length} products`);
        }

        totalSeedsProcessed++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`[AMAZON_INGEST] seed error for "${seed.query}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const duration = Date.now() - startTime;
  const summary = {
    requestId,
    queueProcessed: totalQueueProcessed,
    seedsProcessed: totalSeedsProcessed,
    totalItemsIngested,
    budgetDenied,
    durationMs: duration,
  };

  console.log(`[AMAZON_INGEST] Worker complete:`, JSON.stringify(summary));

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
