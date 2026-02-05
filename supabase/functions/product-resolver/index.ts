import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache for eBay OAuth token
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function generateCorrelationId(): string {
  return `pr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getEbayToken(): Promise<string | null> {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60000) {
    return ebayTokenCache.token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      await response.text();
      return null;
    }

    const data = await response.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 7200;

    ebayTokenCache = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return token;
  } catch {
    return null;
  }
}

interface ProductResult {
  id: string;
  provider: string;
  title: string;
  price: number | null;
  currency: string;
  images: string[];
  url: string | null;
  attributes: Record<string, unknown>;
}

function parseCompositeId(id: string): { listingId: string; variant?: string } {
  if (id.includes("||")) {
    const parts = id.split("||");
    if (parts.length >= 2) {
      return {
        listingId: parts[1],
        variant: parts[2] || undefined,
      };
    }
  }

  const underscoreMatch = id.match(/^(?:ebay_|amazon_|rainforest_)?(.+)$/);
  if (underscoreMatch) {
    return { listingId: underscoreMatch[1] };
  }

  return { listingId: id };
}

async function fetchEbayProduct(listingId: string, correlationId: string): Promise<ProductResult | null> {
  const token = await getEbayToken();
  if (!token) {
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} error=EBAY_TOKEN_FAILED`);
    return null;
  }

  try {
    // Try with v1| prefix format first
    const itemId = listingId.startsWith("v1|") ? listingId : `v1|${listingId}|0`;
    const url = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      // Try alternate format
      const altUrl = `https://api.ebay.com/buy/browse/v1/item/v1|${listingId}|0`;
      const altResponse = await fetch(altUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });

      if (!altResponse.ok) {
        console.warn(`[PRODUCT_RESOLVER] ebay_not_found correlationId=${correlationId} listingId=${listingId} status=${response.status}`);
        await altResponse.text();
        return null;
      }

      const data = await altResponse.json();
      return mapEbayItem(data);
    }

    const data = await response.json();
    return mapEbayItem(data);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} provider=ebay listingId=${listingId} error=${errorMessage}`);
    return null;
  }
}

function mapEbayItem(item: any): ProductResult {
  const images: string[] = [];
  if (item.image?.imageUrl) images.push(item.image.imageUrl);
  if (item.additionalImages) {
    for (const img of item.additionalImages) {
      if (img.imageUrl) images.push(img.imageUrl);
    }
  }

  return {
    id: item.itemId || item.legacyItemId,
    provider: "ebay",
    title: item.title || "Unknown",
    price: item.price?.value ? parseFloat(item.price.value) : null,
    currency: item.price?.currency || "USD",
    images,
    url: item.itemWebUrl || null,
    attributes: {
      condition: item.condition,
      conditionDescription: item.conditionDescription,
      seller: item.seller?.username,
      location: item.itemLocation?.postalCode,
      shipping: item.shippingOptions?.[0]?.shippingCost?.value,
    },
  };
}

async function fetchAmazonProduct(listingId: string, correlationId: string): Promise<ProductResult | null> {
  const RAINFOREST_API_KEY = Deno.env.get("RAINFOREST_API_KEY");
  if (!RAINFOREST_API_KEY) {
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} error=RAINFOREST_API_KEY_MISSING`);
    return null;
  }

  try {
    const asin = listingId.replace(/^(amazon_|rainforest_|ASIN_)/i, "").toUpperCase();
    
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", RAINFOREST_API_KEY);
    url.searchParams.set("type", "product");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("asin", asin);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(`[PRODUCT_RESOLVER] amazon_not_found correlationId=${correlationId} asin=${asin} status=${response.status}`);
      await response.text();
      return null;
    }

    const data = await response.json();
    const product = data.product;
    if (!product) return null;

    return {
      id: product.asin,
      provider: "amazon",
      title: product.title || "Unknown",
      price: product.buybox_winner?.price?.value || null,
      currency: product.buybox_winner?.price?.currency || "USD",
      images: product.images?.map((img: any) => img.link) || [],
      url: product.link || null,
      attributes: {
        brand: product.brand,
        rating: product.rating,
        ratingsTotal: product.ratings_total,
        categories: product.categories?.map((c: any) => c.name),
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} provider=amazon listingId=${listingId} error=${errorMessage}`);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  try {
    let provider: string | undefined;
    let id: string | undefined;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        provider = body.provider;
        id = body.id;
      } catch {
        return jsonResponse({
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid JSON body",
          correlationId,
        });
      }
    } else {
      const url = new URL(req.url);
      provider = url.searchParams.get("provider") || undefined;
      id = url.searchParams.get("id") || undefined;
    }

    if (!id) {
      return jsonResponse({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required field: id",
        correlationId,
      });
    }

    const idRaw = id;
    let idDecoded: string;
    try {
      idDecoded = decodeURIComponent(id);
    } catch {
      idDecoded = id;
    }

    console.log(`[PRODUCT_RESOLVER] start provider=${provider || "auto"} idRaw=${idRaw} idDecoded=${idDecoded} correlationId=${correlationId}`);

    const { listingId } = parseCompositeId(idDecoded);

    let resolvedProvider = provider;
    if (!resolvedProvider) {
      if (idDecoded.includes("ebay") || idDecoded.startsWith("v1|")) {
        resolvedProvider = "ebay";
      } else if (idDecoded.includes("amazon") || idDecoded.includes("rainforest") || /^[A-Z0-9]{10}$/.test(listingId)) {
        resolvedProvider = "amazon";
      } else {
        resolvedProvider = "ebay";
      }
    }

    let product: ProductResult | null = null;

    if (resolvedProvider === "ebay") {
      product = await fetchEbayProduct(listingId, correlationId);
    } else if (resolvedProvider === "amazon") {
      product = await fetchAmazonProduct(listingId, correlationId);
    } else {
      return jsonResponse({
        ok: false,
        error: "BAD_REQUEST",
        message: `Unsupported provider: ${resolvedProvider}`,
        correlationId,
      });
    }

    const ms = Date.now() - startTime;

    if (!product) {
      console.log(`[PRODUCT_RESOLVER] not_found correlationId=${correlationId} provider=${resolvedProvider} idDecoded=${idDecoded} ms=${ms}`);
      return jsonResponse({
        ok: false,
        error: "NOT_FOUND",
        message: "Product not found",
        correlationId,
      });
    }

    console.log(`[PRODUCT_RESOLVER] success correlationId=${correlationId} provider=${resolvedProvider} productId=${product.id} ms=${ms}`);

    return jsonResponse({
      ok: true,
      product,
      meta: {
        correlationId,
        resolvedProvider,
        originalId: idRaw,
        decodedId: idDecoded,
        ms,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} error=${errorMessage}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      correlationId,
    });
  }
});
