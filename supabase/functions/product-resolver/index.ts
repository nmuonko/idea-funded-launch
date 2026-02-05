import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateCorrelationId(): string {
  return `pr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

/**
 * Parse composite ID formats:
 * - "ebay_v1||137007358045||0" -> { provider: "ebay", listingId: "137007358045", variant: "0" }
 * - "ebay_137007358045" -> { provider: "ebay", listingId: "137007358045" }
 * - "137007358045" -> { provider: null, listingId: "137007358045" }
 */
function parseCompositeId(id: string): { listingId: string; variant?: string } {
  // Handle "provider_v1||listingId||variant" format
  if (id.includes("||")) {
    const parts = id.split("||");
    // parts[0] might be "ebay_v1" or just "v1"
    // parts[1] is the listing ID
    // parts[2] is the variant (optional)
    if (parts.length >= 2) {
      return {
        listingId: parts[1],
        variant: parts[2] || undefined,
      };
    }
  }

  // Handle "provider_listingId" format
  const underscoreMatch = id.match(/^(?:ebay_|amazon_|rainforest_)?(.+)$/);
  if (underscoreMatch) {
    return { listingId: underscoreMatch[1] };
  }

  return { listingId: id };
}

async function fetchEbayProduct(listingId: string, correlationId: string): Promise<ProductResult | null> {
  const EBAY_APP_ID = Deno.env.get("EBAY_APP_ID");
  if (!EBAY_APP_ID) {
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} error=EBAY_APP_ID_MISSING`);
    return null;
  }

  try {
    // Use eBay Browse API to get item details
    const itemId = listingId.startsWith("v1|") ? listingId : `v1|${listingId}|0`;
    const url = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${EBAY_APP_ID}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!response.ok) {
      // Try alternate ID format without v1 prefix
      const altUrl = `https://api.ebay.com/buy/browse/v1/item/v1|${listingId}|0`;
      const altResponse = await fetch(altUrl, {
        headers: {
          Authorization: `Bearer ${EBAY_APP_ID}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });

      if (!altResponse.ok) {
        console.warn(`[PRODUCT_RESOLVER] ebay_not_found correlationId=${correlationId} listingId=${listingId} status=${response.status}`);
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
    // Clean ASIN - remove any prefix
    const asin = listingId.replace(/^(amazon_|rainforest_|ASIN_)/i, "").toUpperCase();
    
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", RAINFOREST_API_KEY);
    url.searchParams.set("type", "product");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("asin", asin);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(`[PRODUCT_RESOLVER] amazon_not_found correlationId=${correlationId} asin=${asin} status=${response.status}`);
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  try {
    // Parse input
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

    // Validate required fields
    if (!id) {
      return jsonResponse({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required field: id",
        correlationId,
      });
    }

    // Decode ID (handle URL encoding like %7C%7C)
    const idRaw = id;
    let idDecoded: string;
    try {
      idDecoded = decodeURIComponent(id);
    } catch {
      idDecoded = id; // Use as-is if decoding fails
    }

    console.log(`[PRODUCT_RESOLVER] start provider=${provider || "auto"} idRaw=${idRaw} idDecoded=${idDecoded} correlationId=${correlationId}`);

    // Parse the composite ID to extract listing ID
    const { listingId } = parseCompositeId(idDecoded);

    // Determine provider from ID if not specified
    let resolvedProvider = provider;
    if (!resolvedProvider) {
      if (idDecoded.includes("ebay") || idDecoded.startsWith("v1|")) {
        resolvedProvider = "ebay";
      } else if (idDecoded.includes("amazon") || idDecoded.includes("rainforest") || /^[A-Z0-9]{10}$/.test(listingId)) {
        resolvedProvider = "amazon";
      } else {
        // Default to eBay for numeric IDs
        resolvedProvider = "ebay";
      }
    }

    // Fetch product based on provider
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
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[PRODUCT_RESOLVER][ERROR] correlationId=${correlationId} error=${errorMessage} stack=${stack}`);

    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      correlationId,
    }, 200); // Always return 200 with structured error
  }
});
