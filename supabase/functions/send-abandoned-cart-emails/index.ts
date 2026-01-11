import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
const fromEmail = Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <onboarding@resend.dev>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[send-abandoned-cart-emails] Starting abandoned cart check');

    // Calculate 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Find abandoned carts (DRAFT orders older than 24 hours, not yet reminded)
    const { data: abandonedCarts, error: fetchError } = await supabase
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
      .lt('updated_at', twentyFourHoursAgo.toISOString())
      .or('admin_notes.is.null,admin_notes.not.ilike.%abandoned_cart_email_sent%');

    if (fetchError) {
      console.error('[send-abandoned-cart-emails] Error fetching carts:', fetchError);
      throw fetchError;
    }

    if (!abandonedCarts || abandonedCarts.length === 0) {
      console.log('[send-abandoned-cart-emails] No abandoned carts to process');
      return new Response(JSON.stringify({ 
        message: 'No abandoned carts found',
        emailsSent: 0 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-abandoned-cart-emails] Found abandoned carts:', abandonedCarts.length);

    let emailsSent = 0;
    const errors = [];

    for (const cart of abandonedCarts) {
      try {
        // Get user email
        const { data: userData } = await supabase.auth.admin.getUserById(cart.user_id);
        
        if (!userData?.user?.email) {
          console.log('[send-abandoned-cart-emails] No email found for user:', cart.user_id);
          continue;
        }

        const userEmail = userData.user.email;
        const userName = (cart.profiles as any)?.full_name || (cart.profiles as any)?.name || 'Valued Customer';
        const itemCount = cart.order_items?.length || 0;

        // Generate email HTML
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
            <p>You left ${itemCount} item${itemCount !== 1 ? 's' : ''} in your AfriShop cart. Complete your order now before your items sell out!</p>
            
            <div style="margin: 20px 0;">
              <h3 style="color: #333;">Your Cart Items:</h3>
              ${itemsList}
              ${cart.order_items && cart.order_items.length > 3 ? `<p style="color: #666;">...and ${cart.order_items.length - 3} more item(s)</p>` : ''}
            </div>

            <div style="margin: 20px 0; padding: 15px; background: #eff6ff; border-radius: 5px;">
              <p style="margin: 0; font-size: 18px; font-weight: bold; color: #1e40af;">
                Total: $${cart.total_usd?.toFixed(2) || '0.00'} USD
              </p>
              <p style="margin: 5px 0 0 0; color: #666;">
                (${cart.total_cdf?.toFixed(0) || '0'} FC)
              </p>
            </div>

              <a href="${Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com'}/cart" 
               style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
              Complete Your Order
            </a>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              Need help? Reply to this email or contact our support team.
            </p>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">
              AfriShop - Your trusted e-commerce partner from USA to DRC<br>
              This is an automated reminder. You're receiving this because you have items in your cart.
            </p>
          </div>
        `;

        // Send email via Resend
        await resend.emails.send({
          from: fromEmail,
          to: [userEmail],
          subject: `Complete your order - ${itemCount} item${itemCount !== 1 ? 's' : ''} waiting for you!`,
          html: emailHtml,
        });

        // Mark cart as reminded
        await supabase
          .from('orders')
          .update({ 
            admin_notes: `${cart.admin_notes || ''}\nabandoned_cart_email_sent: ${new Date().toISOString()}`
          })
          .eq('id', cart.id);

        emailsSent++;
        console.log('[send-abandoned-cart-emails] Email sent to:', userEmail);

      } catch (emailError: any) {
        console.error('[send-abandoned-cart-emails] Error sending email for cart:', cart.id, emailError);
        errors.push({ cartId: cart.id, error: emailError.message });
      }
    }

    console.log('[send-abandoned-cart-emails] Process complete. Emails sent:', emailsSent);

    return new Response(JSON.stringify({ 
      message: 'Abandoned cart emails sent',
      emailsSent,
      totalCarts: abandonedCarts.length,
      errors: errors.length > 0 ? errors : undefined
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[send-abandoned-cart-emails] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
