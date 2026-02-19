/**
 * catalog-prewarm-home
 * 
 * Async Home Feed Prewarming - Returns immediately with job ID
 * 
 * This function now uses an async queue-based architecture:
 * 1. Creates a pending job in prewarm_jobs table
 * 2. Triggers background worker (fire-and-forget)
 * 3. Returns immediately with jobId for UI polling
 * 
 * Authentication:
 * - Admin token (Authorization header) OR
 * - Cron secret (x-cron-secret header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { getRotationKey } from "../_shared/homeRotation.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Home sections to prewarm (aligned with catalog-home HOME_SECTIONS)
const HOME_PREWARM_SECTIONS = [
  { key: "homepage", categoryKey: "homepage" },
  { key: "phones", categoryKey: "electronics_phones" },
  { key: "electronics", categoryKey: "electronics" },
  { key: "vehicles", categoryKey: "vehicles_cars_trucks" },
  { key: "gaming", categoryKey: "electronics_gaming" },
  { key: "computers", categoryKey: "electronics_computers" },
  { key: "clothing", categoryKey: "clothing_shoes_accessories" },
  { key: "home_garden", categoryKey: "home_garden" },
  { key: "sporting_goods", categoryKey: "sporting_goods" },
  { key: "toys", categoryKey: "toys" },
  { key: "jewelry_watches", categoryKey: "jewelry_watches" },
  { key: "refurbished", categoryKey: "refurbished" },
  { key: "parts_accessories", categoryKey: "parts_accessories" },
  { key: "beauty_health", categoryKey: "beauty_health" },
  { key: "collectibles", categoryKey: "collectibles" },
  { key: "audio_music", categoryKey: "electronics_audio" },
  { key: "shoes_sneakers", categoryKey: "clothing_shoes" },
  { key: "cameras_photo", categoryKey: "electronics_cameras" },
];

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  console.log(`[PREWARM] requestId=${requestId} Starting async home prewarm`);

  // ─── AUTHENTICATION ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");

  let isAuthorized = false;
  let isCronJob = false;

  // Try cron auth first
  if (cronSecretHeader) {
    const cronAuth = verifyCronAuth(req);
    if (cronAuth.authorized) {
      isAuthorized = true;
      isCronJob = true;
      console.log(`[PREWARM] requestId=${requestId} Authorized via cron secret`);
    }
  }

  // Try admin token auth
  if (!isAuthorized && authHeader) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (supabaseUrl && supabaseKey) {
        const token = authHeader.replace("Bearer ", "");
        const adminSupabase = createClient(supabaseUrl, supabaseKey);
        const { data: { user }, error: userError } = await adminSupabase.auth.getUser(token);
        
        if (!userError && user) {
          const { data: roleData } = await adminSupabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .single();
          
          if (roleData) {
            isAuthorized = true;
            console.log(`[PREWARM] requestId=${requestId} Authorized via admin token: ${user.email}`);
          }
        }
      }
    } catch (err) {
      console.error(`[PREWARM] requestId=${requestId} Admin auth error:`, err);
    }
  }

  if (!isAuthorized) {
    console.warn(`[PREWARM] requestId=${requestId} Unauthorized access attempt`);
    return cronAuthErrorResponse("Unauthorized - admin token or cron secret required");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Backend configuration error",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── PARSE OPTIONAL sectionKey FOR PER-SECTION PUBLISH ──────────────────────
    let sectionKey: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        sectionKey = body.sectionKey || null;
      } catch {
        // No body or invalid JSON - publish all
      }
    }

    // Load settings for rotation key calculation
    const catalogSettings = await getCatalogSettings(supabase);
    const rotationKey = getRotationKey(catalogSettings.homeRotationIntervalMinutes);

    // Determine sections to process
    let sectionsTotal = HOME_PREWARM_SECTIONS.length;
    let sectionIndex: number | undefined;

    if (sectionKey) {
      const idx = HOME_PREWARM_SECTIONS.findIndex(s => s.key === sectionKey);
      if (idx === -1) {
        return new Response(JSON.stringify({
          ok: false,
          error: `Unknown section: ${sectionKey}`,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sectionIndex = idx;
      sectionsTotal = 1;
      console.log(`[PREWARM] requestId=${requestId} rotationKey=${rotationKey} singleSection=${sectionKey}`);
    } else {
      console.log(`[PREWARM] requestId=${requestId} rotationKey=${rotationKey} allSections`);
    }

    // ─── CREATE PENDING JOB ─────────────────────────────────────────────────────
    const { data: job, error: jobError } = await supabase
      .from("prewarm_jobs")
      .insert({
        status: "pending",
        rotation_key: rotationKey,
        sections_total: sectionsTotal,
        sections_completed: 0,
        amazon_fetched: 0,
        ebay_fetched: 0,
        mixed_total: 0,
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error(`[PREWARM] requestId=${requestId} Failed to create job:`, jobError);
      return new Response(JSON.stringify({
        ok: false,
        error: "Failed to create prewarm job",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[PREWARM] requestId=${requestId} Created job: ${job.id}`);

    // ─── TRIGGER BACKGROUND WORKER (FIRE-AND-FORGET) ────────────────────────────
    const workerUrl = `${supabaseUrl}/functions/v1/catalog-prewarm-worker`;
    const workerBody: Record<string, unknown> = { jobId: job.id };
    
    // For single-section jobs, pass sectionKey so worker finds it by key (not positional index)
    if (sectionKey) {
      workerBody.sectionKey = sectionKey;
      workerBody.singleSection = true;
    }
    
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(workerBody),
    }).then(response => {
      console.log(`[PREWARM] requestId=${requestId} Worker triggered, status=${response.status}`);
    }).catch(err => {
      console.error(`[PREWARM] requestId=${requestId} Worker trigger failed:`, err);
      supabase
        .from("prewarm_jobs")
        .update({ 
          status: "failed", 
          error_message: "Failed to trigger background worker" 
        })
        .eq("id", job.id)
        .then(() => {});
    });

    const durationMs = Date.now() - startTime;
    console.log(`[PREWARM] requestId=${requestId} Returning immediately after ${durationMs}ms`);

    // ─── RETURN IMMEDIATELY WITH JOB ID ─────────────────────────────────────────
    return new Response(JSON.stringify({
      ok: true,
      jobId: job.id,
      status: "queued",
      rotationKey,
      sectionsTotal,
      sectionKey: sectionKey || undefined,
      message: sectionKey 
        ? `Prewarm started for section: ${sectionKey}`
        : "Home prewarm started in background",
      durationMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[PREWARM] requestId=${requestId} Error:`, error);

    return new Response(JSON.stringify({
      ok: false,
      error: message,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
