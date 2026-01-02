import { corsHeaders, handleCors, verifyAndGetUser, errorResponse, jsonResponse, AuthError } from '../_shared/auth.ts';

const ALLOWED_STORES = ['AMAZON', 'EBAY', 'WALMART', 'CARVANA', 'CARGURUS', 'BESTBUY', 'TEMU', 'WAYFAIR', 'MERCARI', 'TESLA_USED', 'EDMUNDS', 'OTHER'];
const ALLOWED_CURRENCIES = ['USD', 'CDF'];

interface SubmitPriceConfirmationRequest {
  product_url: string;
  store: string;
  proposed_price: number;
  proposed_currency: string;
  extracted_price?: number;
  extracted_currency?: string;
  extraction_source?: 'structured' | 'dom' | 'manual';
  extraction_confidence?: number;
  cart_item_id?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify authentication
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[submit-price-confirmation] User:', user.id);

    // Parse request body
    const body: SubmitPriceConfirmationRequest = await req.json();
    console.log('[submit-price-confirmation] Request:', JSON.stringify(body));

    // Validate required fields
    if (!body.product_url || typeof body.product_url !== 'string') {
      return errorResponse('product_url is required', 400);
    }

    if (!body.store || !ALLOWED_STORES.includes(body.store.toUpperCase())) {
      return errorResponse(`store must be one of: ${ALLOWED_STORES.join(', ')}`, 400);
    }

    if (typeof body.proposed_price !== 'number' || body.proposed_price <= 0) {
      return errorResponse('proposed_price must be a positive number', 400);
    }

    if (!body.proposed_currency || !ALLOWED_CURRENCIES.includes(body.proposed_currency.toUpperCase())) {
      return errorResponse(`proposed_currency must be one of: ${ALLOWED_CURRENCIES.join(', ')}`, 400);
    }

    // Validate optional fields
    if (body.extraction_confidence !== undefined) {
      if (typeof body.extraction_confidence !== 'number' || body.extraction_confidence < 0 || body.extraction_confidence > 1) {
        return errorResponse('extraction_confidence must be between 0 and 1', 400);
      }
    }

    if (body.extraction_source !== undefined) {
      if (!['structured', 'dom', 'manual'].includes(body.extraction_source)) {
        return errorResponse('extraction_source must be structured, dom, or manual', 400);
      }
    }

    // Insert the price confirmation request
    const { data, error } = await supabase
      .from('price_confirmations')
      .insert({
        user_id: user.id,
        product_url: body.product_url.trim(),
        store: body.store.toUpperCase(),
        proposed_price: body.proposed_price,
        proposed_currency: body.proposed_currency.toUpperCase(),
        extracted_price: body.extracted_price ?? null,
        extracted_currency: body.extracted_currency?.toUpperCase() ?? null,
        extraction_source: body.extraction_source ?? null,
        extraction_confidence: body.extraction_confidence ?? null,
        cart_item_id: body.cart_item_id ?? null,
        status: 'PENDING',
      })
      .select('id, status, created_at')
      .single();

    if (error) {
      console.error('[submit-price-confirmation] Insert error:', error);
      return errorResponse('Failed to create price confirmation request', 500);
    }

    console.log('[submit-price-confirmation] Created:', data.id);

    // CRITICAL: If cart_item_id provided, update the order_item's price_confirmation_status
    if (body.cart_item_id) {
      const { error: cartError } = await supabase
        .from('order_items')
        .update({
          price_confirmation_status: 'PENDING',
          price_confirmation_id: data.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.cart_item_id);

      if (cartError) {
        console.error('[submit-price-confirmation] Failed to update cart item:', cartError);
        // Don't fail the whole request, but log it
      } else {
        console.log('[submit-price-confirmation] Updated cart item:', body.cart_item_id, 'status: PENDING');
      }
    }

    return jsonResponse({
      success: true,
      confirmation_id: data.id,
      status: data.status,
      created_at: data.created_at,
    });

  } catch (error) {
    console.error('[submit-price-confirmation] Error:', error);
    
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});