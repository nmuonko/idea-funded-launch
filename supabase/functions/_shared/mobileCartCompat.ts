import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "./mobileCors.ts";

type CompatOptions = {
  legacyPath: string;
  action: string;
};

const FORWARDED_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-device-id",
  "x-auth-token",
  "x-session-token",
  "x-access-token",
  "x-jwt",
  "x-afrishop-environment",
  "x-afrishop-client",
  "x-supabase-client-info",
  "x-supabase-client-version",
  "x-supabase-client-name",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "user-agent",
  "accept",
  "accept-language",
  "cache-control",
  "pragma",
];

async function parseBody(req: Request): Promise<any> {
  if (req.method === "GET" || req.method === "HEAD") return {};

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return {};

  try {
    return await req.clone().json();
  } catch {
    return {};
  }
}

export function createMobileCartCompatHandler(options: CompatOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return corsPreflightResponse(req);
    }

    const corsHeaders = buildCorsHeaders(req);
    const rid = logStartupRequest("MOBILE_CART_COMPAT", req, {
      legacyPath: options.legacyPath,
      action: options.action,
    });

    const jsonResponse = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

      if (!supabaseUrl || !anonKey) {
        return jsonResponse({
          ok: false,
          success: false,
          error: "CONFIG_ERROR",
          message: "Mobile cart compatibility proxy is not configured.",
        }, 500);
      }

      const headers = new Headers();
      for (const headerName of FORWARDED_HEADERS) {
        const value = req.headers.get(headerName);
        if (value) headers.set(headerName, value);
      }
      headers.set("apikey", headers.get("apikey") || anonKey);
      headers.set("Content-Type", "application/json");

      const incomingUrl = new URL(req.url);
      const forwardedQuery = new URLSearchParams();
      for (const [key, value] of incomingUrl.searchParams.entries()) {
        forwardedQuery.set(key, value);
      }

      const upstreamUrl = `${supabaseUrl}/functions/v1/mobile-cart${forwardedQuery.toString() ? `?${forwardedQuery.toString()}` : ""}`;
      const incomingBody = await parseBody(req);
      const payload = {
        ...(incomingBody && typeof incomingBody === "object" ? incomingBody : {}),
        access_token: incomingUrl.searchParams.get("access_token") ?? undefined,
        accessToken: incomingUrl.searchParams.get("accessToken") ?? undefined,
        token: incomingUrl.searchParams.get("token") ?? undefined,
        jwt: incomingUrl.searchParams.get("jwt") ?? undefined,
        authToken: incomingUrl.searchParams.get("authToken") ?? incomingUrl.searchParams.get("auth_token") ?? undefined,
        bearerToken: incomingUrl.searchParams.get("bearerToken") ?? incomingUrl.searchParams.get("bearer_token") ?? undefined,
        sessionToken: incomingUrl.searchParams.get("sessionToken") ?? incomingUrl.searchParams.get("session_token") ?? undefined,
        action: options.action,
      };

      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await upstreamResponse.text();
      console.log(`[mobile-cart-compat] rid=${rid} legacy=${options.legacyPath} action=${options.action} upstreamStatus=${upstreamResponse.status}`);

      let finalResponseText = responseText;
      if (options.action === "get_cart") {
        try {
          const parsed = JSON.parse(responseText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const rawActiveItems = Array.isArray(parsed.activeItems)
              ? parsed.activeItems
              : Array.isArray(parsed.items)
                ? parsed.items
                : Array.isArray(parsed.cartItems)
                  ? parsed.cartItems
                  : [];
            const rawSavedItems = Array.isArray(parsed.savedItems)
              ? parsed.savedItems
              : Array.isArray(parsed.saved_items)
                ? parsed.saved_items
                : [];
            const summary = parsed.summary && typeof parsed.summary === "object" ? parsed.summary : {};
            const success = typeof parsed.success === "boolean"
              ? parsed.success
              : typeof parsed.ok === "boolean"
                ? parsed.ok
                : upstreamResponse.ok;

            const normalizeItem = (item: any) => ({
              ...item,
              productUrl: item.productUrl ?? item.product_url ?? null,
              product_url: item.product_url ?? item.productUrl ?? null,
              productTitle: item.productTitle ?? item.product_title ?? item.title ?? null,
              product_title: item.product_title ?? item.productTitle ?? item.title ?? null,
              title: item.title ?? item.productTitle ?? item.product_title ?? null,
              imageUrl: item.imageUrl ?? item.productImageUrl ?? item.product_image_url ?? item.mainImageUrl ?? item.image_url ?? null,
              productImageUrl: item.productImageUrl ?? item.product_image_url ?? item.imageUrl ?? item.mainImageUrl ?? item.image_url ?? null,
              product_image_url: item.product_image_url ?? item.productImageUrl ?? item.imageUrl ?? item.mainImageUrl ?? item.image_url ?? null,
              image_url: item.image_url ?? item.product_image_url ?? item.productImageUrl ?? item.imageUrl ?? item.mainImageUrl ?? null,
              provider: item.provider ?? item.store ?? null,
              store: item.store ?? item.provider ?? null,
              base_price_usd: item.base_price_usd ?? item.basePriceUsd ?? item.unitPriceUsd ?? 0,
              unit_price_usd: item.unit_price_usd ?? item.unitPriceUsd ?? item.basePriceUsd ?? 0,
              subtotal_usd: item.subtotal_usd ?? item.subtotalUsd ?? item.itemSubtotalUsd ?? 0,
              markup_fee_usd: item.markup_fee_usd ?? item.markupFeeUsd ?? item.itemMarginUsd ?? 0,
              shipping_fee_usd: item.shipping_fee_usd ?? item.shippingFeeUsd ?? item.itemShippingUsd ?? 0,
              total_price_usd: item.total_price_usd ?? item.totalPriceUsd ?? item.itemTotalUsd ?? item.lineTotalUsd ?? 0,
              total_price_cdf: item.total_price_cdf ?? item.totalPriceCdf ?? item.lineTotalCdf ?? 0,
              is_saved_for_later: item.is_saved_for_later ?? item.isSavedForLater ?? false,
              saved_at: item.saved_at ?? item.savedAt ?? null,
              updated_at: item.updated_at ?? item.updatedAt ?? null,
              is_vehicle: item.is_vehicle ?? item.isVehicle ?? false,
              vehicle_quote_applied: item.vehicle_quote_applied ?? item.vehicleQuoteApplied ?? false,
              price_confirmation_status: item.price_confirmation_status ?? item.priceConfirmationStatus ?? null,
            });

            const activeItems = rawActiveItems.map(normalizeItem);
            const savedItems = rawSavedItems.map(normalizeItem);
            const totals = {
              item_count: parsed.itemCount ?? summary.itemCount ?? activeItems.length,
              items_total_usd: parsed.itemsTotalUsd ?? summary.itemsTotalUsd ?? 0,
              markup_fee_usd: parsed.markupFeeUsd ?? summary.markupFeeUsd ?? 0,
              shipping_fee_usd: parsed.shippingFeeUsd ?? summary.shippingFeeUsd ?? 0,
              total_usd: parsed.totalUsd ?? summary.totalUsd ?? 0,
              total_cdf: parsed.totalCdf ?? summary.totalCdf ?? 0,
              exchange_rate: parsed.exchangeRate ?? summary.exchangeRate ?? null,
            };

            finalResponseText = JSON.stringify({
              ...parsed,
              success,
              ok: parsed.ok ?? success,
              items: activeItems,
              activeItems,
              cartItems: parsed.cartItems ?? activeItems,
              cart_items: parsed.cart_items ?? activeItems,
              savedItems,
              saved_items: parsed.saved_items ?? savedItems,
              cartId: parsed.cartId ?? summary.cartId ?? null,
              cart_id: parsed.cart_id ?? summary.cartId ?? null,
              itemCount: parsed.itemCount ?? summary.itemCount ?? activeItems.length,
              item_count: parsed.item_count ?? summary.itemCount ?? activeItems.length,
              totalUsd: parsed.totalUsd ?? summary.totalUsd ?? 0,
              total_usd: parsed.total_usd ?? summary.totalUsd ?? 0,
              totalCdf: parsed.totalCdf ?? summary.totalCdf ?? 0,
              total_cdf: parsed.total_cdf ?? summary.totalCdf ?? 0,
              exchangeRate: parsed.exchangeRate ?? summary.exchangeRate ?? null,
              exchange_rate: parsed.exchange_rate ?? summary.exchangeRate ?? null,
              summary: { ...summary, ...totals },
              cartSummary: parsed.cartSummary ?? { ...summary, ...totals },
              cart_summary: parsed.cart_summary ?? { ...summary, ...totals },
              totals: parsed.totals ?? totals,
              cart: parsed.cart ?? { id: parsed.cartId ?? summary.cartId ?? null, items: activeItems, saved_items: savedItems, totals },
              data: parsed.data ?? { items: activeItems, cartItems: activeItems, savedItems, summary: { ...summary, ...totals } },
            });
          }
        } catch (error) {
          console.warn(`[mobile-cart-compat] rid=${rid} failed to normalize get_cart response:`, error);
        }
      }

      return new Response(finalResponseText, {
        status: upstreamResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        },
      });
    } catch (error: any) {
      console.error(`[mobile-cart-compat] rid=${rid} legacy=${options.legacyPath} failed:`, error);
      return jsonResponse({
        ok: false,
        success: false,
        error: "COMPAT_PROXY_ERROR",
        message: error?.message || "Compatibility proxy failed.",
      }, 500);
    }
  };
}
