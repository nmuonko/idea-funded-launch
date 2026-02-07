import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── CONFIG ──
const PER_QUERY_TIMEOUT_MS = 10_000; // 10s max per search call
const WALL_CLOCK_LIMIT_MS = 140_000; // Stop at 140s to leave room for final DB writes
const DELAY_BETWEEN_MS = 200;

// ── TEST QUERIES ──
const TEST_QUERIES: { category: string; query: string }[] = [
  // Phones & accessories
  { category: "phones", query: "iphone 11" },
  { category: "phones", query: "iphone 13 pro max" },
  { category: "phones", query: "iphone 15 pro max" },
  { category: "phones", query: "samsung s23 ultra" },
  { category: "phones", query: "samsung s24" },
  { category: "phones", query: "samsung a14" },
  { category: "phones", query: "samsung a54" },
  { category: "phones", query: "infinix hot 40" },
  { category: "phones", query: "tecno spark 10" },
  { category: "phones", query: "tecno camon 20" },
  { category: "phones", query: "redmi note 13" },
  { category: "phone_accessories", query: "chargeur iphone" },
  { category: "phone_accessories", query: "chargeur type c" },
  { category: "phone_accessories", query: "power bank 20000mah" },
  { category: "phone_accessories", query: "écouteurs bluetooth" },
  { category: "phone_accessories", query: "airpods" },
  { category: "phone_accessories", query: "coque iphone 13" },
  { category: "phone_accessories", query: "protection écran iphone" },
  // Appliances
  { category: "appliances", query: "frigo" },
  { category: "appliances", query: "frigo américain" },
  { category: "appliances", query: "congélateur" },
  { category: "appliances", query: "climatiseur" },
  { category: "appliances", query: "ventilateur" },
  { category: "appliances", query: "cuisinière 4 feux" },
  { category: "appliances", query: "micro onde" },
  { category: "appliances", query: "blender" },
  { category: "appliances", query: "machine à laver" },
  { category: "appliances", query: "groupe électrogène" },
  { category: "appliances", query: "générateur 5kva" },
  { category: "appliances", query: "stabilisateur tension" },
  { category: "appliances", query: "panneau solaire 300w" },
  { category: "appliances", query: "kit solaire maison" },
  // Vehicles
  { category: "vehicles", query: "toyota rav4" },
  { category: "vehicles", query: "toyota land cruiser" },
  { category: "vehicles", query: "toyota hilux" },
  { category: "vehicles", query: "prado" },
  { category: "vehicles", query: "corolla" },
  { category: "vehicles", query: "jeep" },
  { category: "vehicles", query: "mercedes c300" },
  { category: "vehicles", query: "bmw x5" },
  { category: "vehicles", query: "moto honda" },
  { category: "vehicles", query: "moto cg 125" },
  { category: "vehicles", query: "scooter 150cc" },
  // Vehicle parts
  { category: "vehicle_parts", query: "pneus toyota" },
  { category: "vehicle_parts", query: "batterie voiture 12v" },
  { category: "vehicle_parts", query: "huile moteur 5w30" },
  // Agriculture / chantier
  { category: "agriculture", query: "tracteur" },
  { category: "agriculture", query: "tracteur agricole" },
  { category: "agriculture", query: "farm tractor" },
  { category: "agriculture", query: "motoculteur" },
  { category: "agriculture", query: "pompe à eau" },
  { category: "agriculture", query: "motopompe essence" },
  { category: "agriculture", query: "pulvérisateur" },
  { category: "agriculture", query: "semoir" },
  { category: "agriculture", query: "broyeur" },
  { category: "agriculture", query: "machette" },
  { category: "agriculture", query: "tronçonneuse" },
  { category: "agriculture", query: "poste à souder" },
  { category: "agriculture", query: "perceuse" },
  { category: "agriculture", query: "scie circulaire" },
  // Gaming / tech
  { category: "gaming", query: "ps5" },
  { category: "gaming", query: "ps4" },
  { category: "gaming", query: "manette ps5" },
  { category: "gaming", query: "xbox series s" },
  { category: "gaming", query: "nintendo switch" },
  { category: "gaming", query: "fifa 24" },
  { category: "gaming", query: "gta 5" },
  { category: "gaming", query: "casque gaming" },
  { category: "gaming", query: "laptop gaming" },
  { category: "gaming", query: "ordinateur portable i7" },
  { category: "gaming", query: "macbook air m1" },
  { category: "gaming", query: "imprimante hp" },
  { category: "gaming", query: "routeur wifi" },
  { category: "gaming", query: "starlink" },
  // Fashion
  { category: "fashion", query: "nike air force 1" },
  { category: "fashion", query: "jordan 4" },
  { category: "fashion", query: "adidas samba" },
  { category: "fashion", query: "yeezy" },
  { category: "fashion", query: "crocs" },
  { category: "fashion", query: "sac à main" },
  { category: "fashion", query: "montre homme" },
  { category: "fashion", query: "parfum" },
  { category: "fashion", query: "perruque" },
  { category: "fashion", query: "tissage brésilien" },
  { category: "fashion", query: "robe soirée" },
  { category: "fashion", query: "costume homme" },
  // Baby / home
  { category: "baby_home", query: "poussette" },
  { category: "baby_home", query: "couche pampers" },
  { category: "baby_home", query: "biberon" },
  { category: "baby_home", query: "lait infantile" },
  { category: "baby_home", query: "lit bébé" },
  { category: "baby_home", query: "mixeur bébé" },
  { category: "baby_home", query: "moustiquaire" },
  { category: "baby_home", query: "draps" },
  { category: "baby_home", query: "rideaux" },
  // Typos / variations
  { category: "typos", query: "samsng a54" },
  { category: "typos", query: "iphne 13" },
  { category: "typos", query: "frigo americain" },
  { category: "typos", query: "tracteurs" },
  { category: "typos", query: "chargeur iphon" },
  { category: "typos", query: "nike airforc" },
];

// ── KEYWORD LISTS ──
const ACCESSORY_WORDS = [
  "case","cover","coque","screen protector","protector","tempered","glass",
  "charger","cable","adapter","usb","type-c","type c","magsafe",
  "mount","holder","phone mount","ring","earbuds","headphones","airpods",
  "power bank","battery pack","wireless charger","pop socket","lens",
];

const VEHICLE_PARTS_WORDS = [
  "brake","rotor","pad","bumper","headlight","taillight","tail light","mirror",
  "filter","oil filter","air filter","spark plug","wheel","rim","tire","tyre",
  "sensor","o2 sensor","camera","dash cam","mat","floor mat",
  "axle","bearing","hub","caliper","alternator","starter","radiator",
  "injector","strut","shock","gasket","cv","control arm","suspension",
  "oem","aftermarket","led","bulb","light bar",
];

const PHONE_BRANDS = ["iphone","samsung","galaxy","infinix","tecno","xiaomi","redmi","pixel","oneplus","oppo","vivo","nokia","itel"];

const APPLIANCE_WORDS = [
  "refrigerator","fridge","frigo","réfrigérateur","freezer","congélateur",
  "air conditioner","ac","climatiseur","fan","ventilateur",
  "stove","cooktop","oven","cuisinière","microwave","micro onde",
  "blender","mixeur","washer","washing machine","machine à laver",
  "generator","genset","kva","générateur","groupe électrogène",
  "inverter","voltage stabilizer","stabilisateur","avr",
  "solar panel","panneau solaire","solar kit","kit solaire",
];

const GAMING_WORDS = ["ps5","playstation","ps4","xbox","nintendo","switch","fifa","gta","controller","dualsense","game","gaming","manette","casque gaming"];

const FASHION_WORDS = ["nike","jordan","adidas","yeezy","crocs","handbag","sac","watch","montre","perfume","parfum","wig","perruque","dress","robe","suit","costume","tissage","samba","air force"];

const BABY_HOME_WORDS = ["stroller","poussette","pampers","diaper","couche","bottle","biberon","infant formula","lait infantile","lait","crib","lit bébé","mosquito net","moustiquaire","sheets","draps","curtains","rideaux","mixeur bébé"];

const AGRICULTURE_WORDS = ["tractor","tracteur","tracteurs","tiller","motoculteur","water pump","pompe","motopompe","sprayer","pulvérisateur","seeder","semoir","grinder","broyeur","machete","machette","chainsaw","tronçonneuse","welder","souder","drill","perceuse","circular saw","scie circulaire","farm"];

// ── HELPERS ──
function hasAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some(w => t.includes(w.toLowerCase()));
}

function hasYearToken(text: string): boolean {
  return /\b(19|20)\d{2}\b/.test(text);
}

// ── RELEVANCY EVALUATOR ──
interface EvalResult {
  top3Relevant: number;
  top12Relevant: number;
  partsBleedRate: number;
  zeroPriceCount: number;
  missingImageCount: number;
  failReasons: string[];
  providerAmazonCount: number;
  providerEbayCount: number;
}

function evaluateResults(
  items: any[],
  category: string,
  query: string,
  latencyMs: number,
  debugHeaders: any,
): EvalResult {
  const failReasons: string[] = [];
  const qLower = query.toLowerCase();

  if (!items || items.length === 0) {
    return {
      top3Relevant: 0, top12Relevant: 0, partsBleedRate: 0,
      zeroPriceCount: 0, missingImageCount: 0,
      failReasons: ["ZERO_RESULTS"],
      providerAmazonCount: 0, providerEbayCount: 0,
    };
  }

  const top12 = items.slice(0, 12);
  const top3 = items.slice(0, 3);

  const zeroPriceCount = items.filter(i => !i.priceUsd && !i.price_usd || (i.priceUsd || i.price_usd || 0) <= 0).length;
  const missingImageCount = items.filter(i => !i.imageUrl && !i.image_url).length;
  const providerAmazonCount = items.filter(i => (i.provider || "").toLowerCase() === "amazon").length;
  const providerEbayCount = items.filter(i => (i.provider || "").toLowerCase() === "ebay").length;

  if (zeroPriceCount > 0) failReasons.push("ZERO_PRICE_ITEMS_PRESENT");
  if (missingImageCount > 0) failReasons.push("MISSING_IMAGE_ITEMS_PRESENT");
  if (latencyMs > 4500) failReasons.push("SLOW_QUERY");

  const debugStr = JSON.stringify(debugHeaders || {}).toLowerCase();
  if (debugStr.includes("timeout") || debugStr.includes("error")) {
    failReasons.push("PROVIDER_TIMEOUT_OR_ERROR");
  }

  let top3Relevant = 0;
  let top12Relevant = 0;
  let partsBleedRate = 0;

  const isRelevant = (title: string): boolean => {
    const tLower = (title || "").toLowerCase();
    switch (category) {
      case "phones": {
        const qTokens = qLower.split(/\s+/);
        const hasModelToken = qTokens.some(t => tLower.includes(t) && t.length > 1);
        const isAccessory = hasAny(tLower, ACCESSORY_WORDS) && !hasAny(tLower, ["smartphone","unlocked","5g","128gb","256gb","512gb","phone"]);
        return hasModelToken && !isAccessory;
      }
      case "phone_accessories": {
        return hasAny(tLower, ACCESSORY_WORDS) || hasAny(tLower, ["chargeur","coque","écouteurs","protection","charger","case","cover","airpods","power bank","earbuds"]);
      }
      case "vehicles": {
        const isPart = hasAny(tLower, VEHICLE_PARTS_WORDS);
        const qTokens = qLower.split(/\s+/);
        const hasModelToken = qTokens.some(t => tLower.includes(t) && t.length > 2);
        return hasModelToken && !isPart;
      }
      case "vehicle_parts": {
        return hasAny(tLower, VEHICLE_PARTS_WORDS) || hasAny(tLower, ["pneus","batterie","huile","tire","battery","oil"]);
      }
      case "appliances": {
        return hasAny(tLower, APPLIANCE_WORDS);
      }
      case "agriculture": {
        return hasAny(tLower, AGRICULTURE_WORDS) || hasAny(tLower, ["tractor","tracteur","drill","perceuse","welder","souder","chainsaw","tronçonneuse","pump","pompe"]);
      }
      case "gaming": {
        return hasAny(tLower, GAMING_WORDS) || hasAny(tLower, ["laptop","computer","ordinateur","macbook","printer","imprimante","router","routeur","starlink","wifi"]);
      }
      case "fashion": {
        return hasAny(tLower, FASHION_WORDS);
      }
      case "baby_home": {
        return hasAny(tLower, BABY_HOME_WORDS);
      }
      case "typos": {
        return tLower.length > 5;
      }
      default:
        return true;
    }
  };

  top3Relevant = top3.filter(i => isRelevant(i.title)).length;
  top12Relevant = top12.filter(i => isRelevant(i.title)).length;

  if (category === "vehicles") {
    const partsInTop12 = top12.filter(i => hasAny((i.title || "").toLowerCase(), VEHICLE_PARTS_WORDS)).length;
    partsBleedRate = top12.length > 0 ? partsInTop12 / top12.length : 0;
    if (partsBleedRate > 0.25) failReasons.push("HIGH_PARTS_BLEED");
  }

  if (category === "phones") {
    const accessoryInTop12 = top12.filter(i => hasAny((i.title || "").toLowerCase(), ACCESSORY_WORDS)).length;
    if (top12.length > 0 && accessoryInTop12 / top12.length > 0.5) failReasons.push("ACCESSORY_DOMINATION");
  }

  if (category !== "typos") {
    if (top3Relevant < 2) failReasons.push("LOW_RELEVANCY_TOP3");
    if (top12Relevant < 7) failReasons.push("LOW_RELEVANCY_TOP12");
  }

  return {
    top3Relevant, top12Relevant, partsBleedRate: Math.round(partsBleedRate * 100) / 100,
    zeroPriceCount, missingImageCount, failReasons,
    providerAmazonCount, providerEbayCount,
  };
}

// ── DB HELPERS ──
async function insertRows(rows: any[], supabaseUrl: string, serviceRoleKey: string) {
  if (rows.length === 0) return;
  await fetch(`${supabaseUrl}/rest/v1/search_relevancy_report_rows`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });
}

async function updateReportSummary(
  reportId: string, passCount: number, failCount: number, avgLatency: number, slowCount: number, totalCompleted: number,
  supabaseUrl: string, serviceRoleKey: string,
) {
  await fetch(`${supabaseUrl}/rest/v1/search_relevancy_reports?id=eq.${reportId}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      total_queries: totalCompleted,
      pass_count: passCount,
      fail_count: failCount,
      avg_latency_ms: avgLatency,
      slow_count: slowCount,
    }),
  });
}

// ── Fetch with timeout ──
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── MAIN ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify admin
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) {
      await userRes.text();
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userData = await userRes.json();
    const userId = userData.id;

    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const roles = await roleRes.json();
    if (!Array.isArray(roles) || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let env = "production";
    try {
      const body = await req.json();
      if (body?.env) env = body.env;
    } catch { /* no body is fine */ }

    // Create report
    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/search_relevancy_reports`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ env, total_queries: TEST_QUERIES.length }),
    });
    const [report] = await createRes.json();
    const reportId = report.id;

    const wallClockStart = Date.now();
    const rows: any[] = [];
    const pendingRows: any[] = [];
    let totalLatency = 0;
    let passCount = 0;
    let failCount = 0;
    let slowCount = 0;
    let completed = 0;
    let stoppedEarly = false;

    for (let i = 0; i < TEST_QUERIES.length; i++) {
      // Wall-clock guard: stop before timeout
      if (Date.now() - wallClockStart > WALL_CLOCK_LIMIT_MS) {
        console.log(`[RELEVANCY] Wall-clock limit reached at ${i}/${TEST_QUERIES.length}, saving partial results`);
        stoppedEarly = true;
        break;
      }

      const tq = TEST_QUERIES[i];
      if (i > 0) await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));

      const searchUrl = `${SUPABASE_URL}/functions/v1/catalog-search?q=${encodeURIComponent(tq.query)}&provider=mixed&limit=20`;
      const start = Date.now();
      let items: any[] = [];
      let debugHeaders: Record<string, string> = {};
      let searchError = false;

      try {
        const res = await fetchWithTimeout(searchUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: authHeader,
          },
        }, PER_QUERY_TIMEOUT_MS);

        const latency = Date.now() - start;

        for (const h of ["x-afrishop-search-debug", "x-afrishop-search-intent", "x-correlation-id", "cache-control"]) {
          const v = res.headers.get(h);
          if (v) debugHeaders[h] = v;
        }

        if (res.ok) {
          const data = await res.json();
          items = data?.items || [];
        } else {
          await res.text();
          searchError = true;
        }

        const evalResult = evaluateResults(items, tq.category, tq.query, latency, debugHeaders);
        if (searchError) evalResult.failReasons.push("PROVIDER_TIMEOUT_OR_ERROR");

        const passed = evalResult.failReasons.length === 0;
        if (passed) passCount++; else failCount++;
        if (latency > 4500) slowCount++;
        totalLatency += latency;
        completed++;

        const row = {
          report_id: reportId,
          category: tq.category,
          query: tq.query,
          returned_count: items.length,
          top3_relevant: evalResult.top3Relevant,
          top12_relevant: evalResult.top12Relevant,
          parts_bleed_rate: evalResult.partsBleedRate,
          zero_price_count: evalResult.zeroPriceCount,
          missing_image_count: evalResult.missingImageCount,
          latency_ms: latency,
          provider_amazon_count: evalResult.providerAmazonCount,
          provider_ebay_count: evalResult.providerEbayCount,
          fail_reasons: evalResult.failReasons,
          sample_top3_titles: items.slice(0, 3).map((it: any) => (it.title || "").substring(0, 120)),
          debug: debugHeaders,
        };

        rows.push(row);
        pendingRows.push(row);

        console.log(`[RELEVANCY] ${i + 1}/${TEST_QUERIES.length} q="${tq.query}" cat=${tq.category} returned=${items.length} pass=${passed} latency=${latency}ms`);
      } catch (err) {
        const latency = Date.now() - start;
        totalLatency += latency;
        failCount++;
        completed++;

        const row = {
          report_id: reportId,
          category: tq.category,
          query: tq.query,
          returned_count: 0,
          top3_relevant: 0, top12_relevant: 0,
          parts_bleed_rate: 0, zero_price_count: 0, missing_image_count: 0,
          latency_ms: latency,
          provider_amazon_count: 0, provider_ebay_count: 0,
          fail_reasons: ["PROVIDER_TIMEOUT_OR_ERROR"],
          sample_top3_titles: [],
          debug: { error: String(err).substring(0, 200) },
        };
        rows.push(row);
        pendingRows.push(row);

        console.log(`[RELEVANCY] ${i + 1}/${TEST_QUERIES.length} q="${tq.query}" TIMEOUT/ERROR latency=${latency}ms`);
      }

      // Flush pending rows every 10 queries
      if (pendingRows.length >= 10) {
        await insertRows([...pendingRows], SUPABASE_URL, SERVICE_ROLE_KEY);
        pendingRows.length = 0;
      }
    }

    // Flush remaining rows
    if (pendingRows.length > 0) {
      await insertRows(pendingRows, SUPABASE_URL, SERVICE_ROLE_KEY);
    }

    // Update report summary
    const avgLatency = completed > 0 ? Math.round(totalLatency / completed) : 0;
    await updateReportSummary(reportId, passCount, failCount, avgLatency, slowCount, completed, SUPABASE_URL, SERVICE_ROLE_KEY);

    const result = {
      id: reportId,
      env,
      total_queries: completed,
      pass_count: passCount,
      fail_count: failCount,
      avg_latency_ms: avgLatency,
      slow_count: slowCount,
      stopped_early: stoppedEarly,
      rows,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[RELEVANCY] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
