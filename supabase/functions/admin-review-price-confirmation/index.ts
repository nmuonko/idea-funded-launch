import { corsHeaders, handleCors, verifyAndGetUser, errorResponse, jsonResponse, AuthError, createAdminClient } from '../_shared/auth.ts';
import { sendEmail } from '../_shared/email.ts';

const ALLOWED_ACTIONS = ['APPROVE', 'ADJUST', 'REJECT'];
const ALLOWED_CURRENCIES = ['USD', 'CDF'];

interface ReviewPriceConfirmationRequest {
  confirmation_id: string;
  action: 'APPROVE' | 'ADJUST' | 'REJECT';
  admin_price?: number;
  admin_currency?: string;
  admin_note?: string;
}

// Build bilingual price approval email
function buildPriceApprovalEmail(params: {
  customerName: string;
  itemTitle: string;
  approvedPrice: number;
  currency: string;
  orderId?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const { customerName, itemTitle, approvedPrice, currency, orderId, appUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com' } = params;
  
  const formattedPrice = currency === 'USD' 
    ? `$${approvedPrice.toFixed(2)}` 
    : `${approvedPrice.toLocaleString()} CDF`;
  
  // Link to orders page or specific order if orderId provided
  const orderUrl = orderId ? `${appUrl}/orders/${orderId}` : `${appUrl}/orders`;

  return {
    subject: "Prix confirmé — Finalisez votre commande / Price approved — Complete your order",
    html: `
      <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">✓ Prix Confirmé / Price Approved</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Bonjour ${customerName},</p>
          <p>Bonne nouvelle ! Le prix de votre article a été vérifié et confirmé par notre équipe.</p>
          
          <p>Hello ${customerName},</p>
          <p>Good news! The price for your item has been verified and confirmed by our team.</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Article / Item</h2>
            <p style="margin: 5px 0;"><strong>Produit / Product:</strong> ${itemTitle}</p>
            <p style="margin: 5px 0;"><strong>Prix confirmé / Confirmed price:</strong> ${formattedPrice}</p>
          </div>

          <p>Vous pouvez maintenant finaliser votre commande dans l'application mobile AfriShop.</p>
          <p>You can now complete your order in the AfriShop mobile app.</p>
          
          <p style="margin-top: 20px; text-align: center;">
            <a href="${orderUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
              📱 Voir ma commande / View My Order
            </a>
          </p>
          
          <p style="margin-top: 20px;">Merci pour votre confiance ! / Thank you for shopping with AfriShop!</p>
        </div>
        <div style="background: #1e3a5f; padding: 20px; text-align: center; color: white; font-size: 12px;">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
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
    let emailSent = false;
    
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
          
          // Also recalculate markup if we have settings (from cache)
          const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
          const settings = await getCachedGlobalSettings(supabase) as Record<string, any>;
          
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

    // ============================================
    // SEND EMAIL NOTIFICATION ON APPROVAL/ADJUSTMENT
    // ============================================
    if ((action === 'APPROVE' || action === 'ADJUST') && finalPriceUsd !== null) {
      try {
        // Fetch user profile to get email and name
        const { data: userProfile, error: profileError } = await supabase
          .from('profiles')
          .select('email, full_name, name')
          .eq('user_id', existing.user_id)
          .maybeSingle();

        if (profileError) {
          console.error('[admin-review-price-confirmation] Failed to fetch user profile:', profileError);
        }

        const userEmail = userProfile?.email;
        const customerName = userProfile?.full_name || userProfile?.name || 'Customer';

        if (userEmail) {
          // Get cart item title if available
          let itemTitle = 'Your item';
          if (existing.cart_item_id) {
            const { data: cartItem } = await supabase
              .from('order_items')
              .select('title, product_url')
              .eq('id', existing.cart_item_id)
              .maybeSingle();
            
            if (cartItem?.title) {
              itemTitle = cartItem.title;
            } else if (cartItem?.product_url) {
              itemTitle = `Item from ${new URL(cartItem.product_url).hostname}`;
            }
          }

          const emailTemplate = buildPriceApprovalEmail({
            customerName,
            itemTitle,
            approvedPrice: finalPriceUsd,
            currency: updateData.admin_currency || 'USD',
          });

          const emailResult = await sendEmail({
            to: userEmail,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            category: 'order_status_update',
          });

          emailSent = emailResult.success;
          console.log('[admin-review-price-confirmation] Email notification result:', {
            to: userEmail,
            success: emailResult.success,
            id: emailResult.id,
            error: emailResult.error,
          });
        } else {
          console.warn('[admin-review-price-confirmation] No email found for user:', existing.user_id);
        }
      } catch (emailError) {
        console.error('[admin-review-price-confirmation] Failed to send email notification:', emailError);
        // Don't fail the whole request for email failure
      }
    }

    return jsonResponse({
      success: true,
      confirmation: updated,
      cart_item_updated: cartItemUpdated,
      final_price_usd: finalPriceUsd,
      email_sent: emailSent,
    });

  } catch (error) {
    console.error('[admin-review-price-confirmation] Error:', error);
    
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});