/**
 * Catalog Daily Report — sends admin email with catalog health metrics
 * Triggered daily via pg_cron at 8 AM UTC
 */

import { createAdminPostgrestClient } from "../_shared/postgrest.ts";
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-cron-key",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: accept internal cron key or service role
  const cronKey = req.headers.get("x-internal-cron-key");
  const authHeader = req.headers.get("authorization") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const validCron = cronKey === "afrishop-internal-cron-2026";
  const validServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

  if (!validCron && !validServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startMs = Date.now();

  try {
    const supabase = createAdminPostgrestClient();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Run all count queries in parallel
    const [activeRes, inactiveRes, deadRes, added24hRes, valueSampleRes] = await Promise.all([
      supabase.from("catalog_items").select("id").eq("is_active", true).count("exact").limit(0).execute(),
      supabase.from("catalog_items").select("id").eq("is_active", false).count("exact").limit(0).execute(),
      supabase.from("catalog_items").select("id").gte("fail_count", 3).count("exact").limit(0).execute(),
      supabase.from("catalog_items").select("id").eq("is_active", true).gte("first_seen_at", twentyFourHoursAgo).count("exact").limit(0).execute(),
      // Get total value via RPC or sampling — sum price_usd for active items
      // PostgREST doesn't support SUM directly, so we use a simple approach:
      // fetch a count and average from a sample, or just report the count
      supabase.from("catalog_items").select("price_usd").eq("is_active", true).not("price_usd", "is", null).gt("price_usd", 0).limit(1000).execute(),
    ]);

    const activeCount = activeRes.count ?? 0;
    const inactiveCount = inactiveRes.count ?? 0;
    const deadCount = deadRes.count ?? 0;
    const added24hCount = added24hRes.count ?? 0;

    // Estimate total value from sample
    let totalValueEstimate = 0;
    let avgPrice = 0;
    if (valueSampleRes.data && Array.isArray(valueSampleRes.data) && valueSampleRes.data.length > 0) {
      const prices = valueSampleRes.data.map((r: any) => r.price_usd).filter((p: number) => p > 0);
      avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
      totalValueEstimate = avgPrice * activeCount;
    }

    const totalCount = activeCount + inactiveCount;
    const reportDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const formatNum = (n: number) => n.toLocaleString("en-US");
    const formatUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; font-size: 22px; border-bottom: 2px solid #e94560; padding-bottom: 10px;">
          📊 Daily Catalog Report
        </h1>
        <p style="color: #666; font-size: 14px;">${reportDate}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">📦 Total Items</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px;">${formatNum(totalCount)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">✅ Active</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px; color: #28a745;">${formatNum(activeCount)}</td>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">⏸️ Inactive</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px; color: #ffc107;">${formatNum(inactiveCount)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">💀 Dead Links (fail≥3)</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px; color: #dc3545;">${formatNum(deadCount)}</td>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">🆕 Added (24h)</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px; color: #17a2b8;">${formatNum(added24hCount)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">💰 Est. Total Value</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px; color: #6f42c1;">${formatUsd(totalValueEstimate)}</td>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: bold;">📈 Avg. Price</td>
            <td style="padding: 12px; border: 1px solid #dee2e6; text-align: right; font-size: 18px;">${formatUsd(avgPrice)}</td>
          </tr>
        </table>
        
        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px;">
          AfriShop USA — Automated Catalog Report • Generated in ${Date.now() - startMs}ms
        </p>
      </div>
    `;

    const emailResult = await sendEmail({
      to: ADMIN_EMAIL,
      subject: `📊 Catalog Report: ${formatNum(activeCount)} active | ${formatNum(added24hCount)} added today | ${formatUsd(totalValueEstimate)} value`,
      html,
      category: "admin_notification",
    });

    const result = {
      success: emailResult.success,
      emailId: emailResult.id,
      metrics: { totalCount, activeCount, inactiveCount, deadCount, added24hCount, totalValueEstimate: Math.round(totalValueEstimate), avgPrice: Math.round(avgPrice) },
      durationMs: Date.now() - startMs,
    };

    console.log(`[CATALOG_DAILY_REPORT] ${JSON.stringify(result)}`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[CATALOG_DAILY_REPORT] Error: ${errMsg}`);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
