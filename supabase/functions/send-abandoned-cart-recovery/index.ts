import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
const fromEmail = Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <onboarding@resend.dev>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A/B test variant timing (in hours)
const TIMING_VARIANTS = {
  '24h': 24,
  '48h': 48,
  '72h': 72,
};

// High-value cart threshold
const HIGH_VALUE_THRESHOLD = 200;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[send-abandoned-cart-recovery] Starting cart recovery process');

    // Get all A/B test variants
    const variants = Object.keys(TIMING_VARIANTS);
    let totalEmailsSent = 0;
    let totalPushSent = 0;

    for (const variant of variants) {
      const hoursAgo = TIMING_VARIANTS[variant as keyof typeof TIMING_VARIANTS];
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hoursAgo);

      console.log(`[send-abandoned-cart-recovery] Processing ${variant} variant (${hoursAgo}h ago)`);

      // Find carts matching this timing
      const { data: carts, error: fetchError } = await supabase
        .from('orders')
        .select(`
          id,
          user_id,
          total_usd,
          total_cdf,
          admin_notes,
          updated_at,
          profiles!orders_user_id_fkey (
            name,
            full_name
          ),
          order_items (
            id,
            title,
            product_url,
            product_image_url,
            quantity
          )
        `)
        .eq('status', 'DRAFT')
        .lt('updated_at', cutoffTime.toISOString())
        .or(`admin_notes.is.null,admin_notes.not.ilike.%${variant}_email_sent%`);

      if (fetchError) {
        console.error(`[send-abandoned-cart-recovery] Error fetching carts for ${variant}:`, fetchError);
        continue;
      }

      if (!carts || carts.length === 0) {
        console.log(`[send-abandoned-cart-recovery] No carts found for ${variant}`);
        continue;
      }

      console.log(`[send-abandoned-cart-recovery] Found ${carts.length} carts for ${variant}`);

      for (const cart of carts) {
        try {
          // Get user email
          const { data: userData } = await supabase.auth.admin.getUserById(cart.user_id);
          
          if (!userData?.user?.email) {
            console.log('[send-abandoned-cart-recovery] No email for user:', cart.user_id);
            continue;
          }

          const userEmail = userData.user.email;
          const cartValue = cart.total_usd || 0;
          
          // Determine segment
          const segment = cartValue >= HIGH_VALUE_THRESHOLD ? 'high_value' : 'standard';
          const userName = (cart.profiles as any)?.full_name || (cart.profiles as any)?.name || 'Valued Customer';
          const itemCount = cart.order_items?.length || 0;

          // Generate email content based on segment
          let emailSubject = '';
          let emailIntro = '';
          
          if (segment === 'high_value') {
            emailSubject = `🌟 VIP: Your ${itemCount} Premium Items Await!`;
            emailIntro = `<p style="color: #1e40af; font-weight: bold; font-size: 16px;">As a valued customer, we've reserved your high-value order for you!</p>`;
          } else {
            emailSubject = `Complete your order - ${itemCount} item${itemCount !== 1 ? 's' : ''} waiting for you!`;
            emailIntro = '';
          }

          // Build items list
          const itemsList = cart.order_items
            ?.slice(0, 3)
            .map((item: any) => `
              <div style="margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 5px;">
                ${item.product_image_url ? `<img src="${item.product_image_url}" alt="${item.title}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 10px; vertical-align: middle;">` : ''}
                <span style="vertical-align: middle;">${item.title || 'Product'} (x${item.quantity})</span>
              </div>
            `)
            .join('') || '';

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #1e40af;">Don't forget your cart! 🛒</h1>
              <p>Hi ${userName},</p>
              ${emailIntro}
              <p>You left ${itemCount} item${itemCount !== 1 ? 's' : ''} in your AfriShop cart. Complete your order now!</p>
              
              <div style="margin: 20px 0;">
                <h3 style="color: #333;">Your Cart Items:</h3>
                ${itemsList}
                ${cart.order_items && cart.order_items.length > 3 ? `<p style="color: #666;">...and ${cart.order_items.length - 3} more item(s)</p>` : ''}
              </div>

              <div style="margin: 20px 0; padding: 15px; background: ${segment === 'high_value' ? '#fef3c7' : '#eff6ff'}; border-radius: 5px;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: #1e40af;">
                  Total: $${cartValue.toFixed(2)} USD
                </p>
                <p style="margin: 5px 0 0 0; color: #666;">
                  (${cart.total_cdf?.toFixed(0) || '0'} FC)
                </p>
                ${segment === 'high_value' ? '<p style="margin: 10px 0 0 0; color: #92400e; font-weight: bold;">✨ Priority processing for high-value orders!</p>' : ''}
              </div>

              <a href="${Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.com'}" 
                 style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
                Complete Your Order
              </a>

              <p style="color: #666; font-size: 14px; margin-top: 30px;">
                Need help? Reply to this email or contact our support team.
              </p>

              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              <p style="color: #999; font-size: 12px;">
                AfriShop - Your trusted e-commerce partner from USA to DRC<br>
                Test variant: ${variant} | Segment: ${segment}
              </p>
            </div>
          `;

          // Send email
          await resend.emails.send({
            from: fromEmail,
            to: [userEmail],
            subject: emailSubject,
            html: emailHtml,
          });

          totalEmailsSent++;

          // Try to send push notification
          try {
            const pushResponse = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userId: cart.user_id,
                  title: segment === 'high_value' ? '🌟 Your VIP Cart Awaits!' : 'Complete Your Order',
                  body: `${itemCount} item${itemCount !== 1 ? 's' : ''} - $${cartValue.toFixed(2)} total`,
                  data: {
                    type: 'abandoned_cart',
                    orderId: cart.id,
                    variant,
                  },
                }),
              }
            );

            if (pushResponse.ok) {
              const pushResult = await pushResponse.json();
              totalPushSent += pushResult.sent || 0;
            }
          } catch (pushError) {
            console.error('[send-abandoned-cart-recovery] Push notification error:', pushError);
          }

          // Track A/B test
          await supabase
            .from('cart_recovery_ab_tests')
            .insert({
              order_id: cart.id,
              variant_name: variant,
              cart_value_usd: cartValue,
              segment: segment,
            });

          // Mark cart as reminded for this variant
          await supabase
            .from('orders')
            .update({ 
              admin_notes: `${cart.admin_notes || ''}\n${variant}_email_sent: ${new Date().toISOString()}`
            })
            .eq('id', cart.id);

          console.log(`[send-abandoned-cart-recovery] Sent ${variant} to:`, userEmail);

        } catch (error: any) {
          console.error('[send-abandoned-cart-recovery] Error processing cart:', cart.id, error);
        }
      }
    }

    console.log('[send-abandoned-cart-recovery] Process complete. Emails:', totalEmailsSent, 'Push:', totalPushSent);

    return new Response(JSON.stringify({ 
      success: true,
      emailsSent: totalEmailsSent,
      pushNotificationsSent: totalPushSent
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[send-abandoned-cart-recovery] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
