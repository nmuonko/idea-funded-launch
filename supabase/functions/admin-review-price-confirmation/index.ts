import { corsHeaders, handleCors, verifyAndGetUser, errorResponse, jsonResponse, AuthError, createAdminClient } from '../_shared/auth.ts';

const ALLOWED_ACTIONS = ['APPROVE', 'ADJUST', 'REJECT'];
const ALLOWED_CURRENCIES = ['USD', 'CDF'];

interface ReviewPriceConfirmationRequest {
  confirmation_id: string;
  action: 'APPROVE' | 'ADJUST' | 'REJECT';
  admin_price?: number;
  admin_currency?: string;
  admin_note?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify authentication
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[admin-review-price-confirmation] User:', user.id);

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError) {
      console.error('[admin-review-price-confirmation] Role check error:', roleError);
      return errorResponse('Failed to verify admin status', 500);
    }

    if (!roleData) {
      console.warn('[admin-review-price-confirmation] Non-admin access attempt:', user.id);
      return errorResponse('Admin access required', 403);
    }

    // Parse request body
    const body: ReviewPriceConfirmationRequest = await req.json();
    console.log('[admin-review-price-confirmation] Request:', JSON.stringify(body));

    // Validate required fields
    if (!body.confirmation_id || typeof body.confirmation_id !== 'string') {
      return errorResponse('confirmation_id is required', 400);
    }

    if (!body.action || !ALLOWED_ACTIONS.includes(body.action.toUpperCase())) {
      return errorResponse(`action must be one of: ${ALLOWED_ACTIONS.join(', ')}`, 400);
    }

    const action = body.action.toUpperCase();

    // Load the existing confirmation
    const { data: existing, error: fetchError } = await supabase
      .from('price_confirmations')
      .select('*')
      .eq('id', body.confirmation_id)
      .single();

    if (fetchError || !existing) {
      console.error('[admin-review-price-confirmation] Fetch error:', fetchError);
      return errorResponse('Price confirmation not found', 404);
    }

    if (existing.status !== 'PENDING') {
      return errorResponse(`Cannot review: status is already ${existing.status}`, 400);
    }

    // Prepare update data based on action
    const updateData: Record<string, any> = {
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      admin_note: body.admin_note ?? null,
    };

    let finalPriceUsd: number | null = null;

    if (action === 'APPROVE') {
      updateData.status = 'APPROVED';
      // Use admin-provided price if available, otherwise use proposed price
      updateData.admin_price = body.admin_price ?? existing.proposed_price;
      updateData.admin_currency = body.admin_currency?.toUpperCase() ?? existing.proposed_currency;
      finalPriceUsd = updateData.admin_price;
    } else if (action === 'ADJUST') {
      // ADJUST requires admin_price and admin_currency
      if (typeof body.admin_price !== 'number' || body.admin_price <= 0) {
        return errorResponse('admin_price is required for ADJUST action and must be positive', 400);
      }
      if (!body.admin_currency || !ALLOWED_CURRENCIES.includes(body.admin_currency.toUpperCase())) {
        return errorResponse(`admin_currency is required for ADJUST action and must be one of: ${ALLOWED_CURRENCIES.join(', ')}`, 400);
      }
      updateData.status = 'ADJUSTED';
      updateData.admin_price = body.admin_price;
      updateData.admin_currency = body.admin_currency.toUpperCase();
      finalPriceUsd = body.admin_price;
    } else if (action === 'REJECT') {
      updateData.status = 'REJECTED';
      updateData.admin_price = null;
      updateData.admin_currency = null;
    }

    // Perform the update on price_confirmations
    const { data: updated, error: updateError } = await supabase
      .from('price_confirmations')
      .update(updateData)
      .eq('id', body.confirmation_id)
      .select('*')
      .single();

    if (updateError) {
      console.error('[admin-review-price-confirmation] Update error:', updateError);
      return errorResponse('Failed to update price confirmation', 500);
    }

    console.log('[admin-review-price-confirmation] Updated confirmation:', updated.id, 'to', updated.status);

    // CRITICAL: Update the linked order_items if cart_item_id exists
    let cartItemUpdated = false;
    if (existing.cart_item_id) {
      const cartItemUpdate: Record<string, any> = {
        price_confirmation_status: updateData.status,
        price_confirmation_id: body.confirmation_id,
        updated_at: new Date().toISOString(),
      };

      // If approved or adjusted, update the base_price_usd with the admin-approved price
      if (action === 'APPROVE' || action === 'ADJUST') {
        if (finalPriceUsd !== null) {
          cartItemUpdate.admin_adjusted_price = finalPriceUsd;
          cartItemUpdate.base_price_usd = finalPriceUsd;
          
          // Also recalculate markup if we have settings
          const { data: settings } = await supabase
            .from('settings')
            .select('markup_percent, exchange_rate_usd_to_cdf')
            .single();
          
          if (settings) {
            const markupPercent = Number(settings.markup_percent ?? 15) / 100;
            const markupFeeUsd = Math.round(finalPriceUsd * markupPercent * 100) / 100;
            const subtotalUsd = finalPriceUsd;
            const totalPriceUsd = Math.round((finalPriceUsd + markupFeeUsd) * 100) / 100;
            const totalPriceCdf = Math.round(totalPriceUsd * Number(settings.exchange_rate_usd_to_cdf) * 100) / 100;
            
            cartItemUpdate.markup_fee_usd = markupFeeUsd;
            cartItemUpdate.subtotal_usd = subtotalUsd;
            cartItemUpdate.total_price_usd = totalPriceUsd;
            cartItemUpdate.total_price_cdf = totalPriceCdf;
            
            console.log('[admin-review-price-confirmation] Recalculated cart item prices:', {
              base_price_usd: finalPriceUsd,
              markup_fee_usd: markupFeeUsd,
              total_price_usd: totalPriceUsd,
            });
          }
        }
      }

      const { error: cartError } = await supabase
        .from('order_items')
        .update(cartItemUpdate)
        .eq('id', existing.cart_item_id);

      if (cartError) {
        console.error('[admin-review-price-confirmation] Failed to update cart item:', cartError);
        // Don't fail the whole request, but log it
      } else {
        cartItemUpdated = true;
        console.log('[admin-review-price-confirmation] Updated cart item:', existing.cart_item_id, 'status:', updateData.status);
      }
    }

    return jsonResponse({
      success: true,
      confirmation: updated,
      cart_item_updated: cartItemUpdated,
      final_price_usd: finalPriceUsd,
    });

  } catch (error) {
    console.error('[admin-review-price-confirmation] Error:', error);
    
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});