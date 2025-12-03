import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration
const SAVED_AGE_THRESHOLD_HOURS = 48; // Items saved for at least 48 hours
const REMINDER_COOLDOWN_DAYS = 5; // Don't send another reminder within 5 days

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[saved-cart-reminders] Starting reminder job');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      console.error('[saved-cart-reminders] RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date();
    const savedAgeThreshold = new Date(now.getTime() - SAVED_AGE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const reminderCooldown = new Date(now.getTime() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    console.log('[saved-cart-reminders] Thresholds:', {
      savedAgeThreshold: savedAgeThreshold.toISOString(),
      reminderCooldown: reminderCooldown.toISOString(),
    });

    // Find users with saved items that need reminders
    // Items must be:
    // 1. is_saved_for_later = true
    // 2. saved_at is at least SAVED_AGE_THRESHOLD_HOURS old
    // 3. last_reminder_at is null OR older than REMINDER_COOLDOWN_DAYS
    const { data: savedItems, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id,
        product_url,
        title,
        store,
        base_price_usd,
        quantity,
        saved_at,
        last_reminder_at,
        orders!inner(
          id,
          user_id,
          status
        )
      `)
      .eq('is_saved_for_later', true)
      .eq('orders.status', 'DRAFT')
      .lt('saved_at', savedAgeThreshold.toISOString());

    if (itemsError) {
      console.error('[saved-cart-reminders] Error fetching saved items:', itemsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch saved items' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!savedItems || savedItems.length === 0) {
      console.log('[saved-cart-reminders] No qualifying saved items found');
      return new Response(
        JSON.stringify({ message: 'No reminders to send', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter items that haven't received a reminder recently
    const qualifyingItems = savedItems.filter(item => {
      if (!item.last_reminder_at) return true;
      return new Date(item.last_reminder_at) < reminderCooldown;
    });

    console.log('[saved-cart-reminders] Qualifying items:', qualifyingItems.length);

    // Group items by user
    const userItemsMap = new Map<string, any[]>();
    qualifyingItems.forEach(item => {
      const userId = (item.orders as any).user_id;
      if (!userItemsMap.has(userId)) {
        userItemsMap.set(userId, []);
      }
      userItemsMap.get(userId)!.push(item);
    });

    console.log('[saved-cart-reminders] Users to notify:', userItemsMap.size);

    // Get user profiles and emails
    const userIds = Array.from(userItemsMap.keys());
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, full_name, name')
      .in('user_id', userIds);

    if (profilesError) {
      console.error('[saved-cart-reminders] Error fetching profiles:', profilesError);
    }

    // Get user emails from auth.users via admin API
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      console.error('[saved-cart-reminders] Error fetching auth users:', authError);
    }

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
    const authUserMap = new Map(authUsers?.users?.map(u => [u.id, u]) || []);

    let emailSentCount = 0;
    let pushSentCount = 0;
    let errorCount = 0;
    const itemsToUpdate: string[] = [];

    // Send emails and push notifications to each user
    for (const [userId, items] of userItemsMap) {
      const profile = profileMap.get(userId);
      const authUser = authUserMap.get(userId);
      
      if (!authUser?.email) {
        console.log('[saved-cart-reminders] Skipping user without email:', userId);
        continue;
      }

      const userName = profile?.full_name || profile?.name || 'Valued Customer';
      const userEmail = authUser.email;

      // Build email content
      const itemsHtml = items.map(item => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
            ${item.title || item.store || 'Product'}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
            ${item.store}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
            $${(item.base_price_usd || 0).toFixed(2)}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            ${item.quantity || 1}
          </td>
        </tr>
      `).join('');

      const totalValue = items.reduce((sum, item) => 
        sum + (Number(item.base_price_usd || 0) * (item.quantity || 1)), 0
      );

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 32px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">AfriShop</h1>
            </div>
            
            <div style="padding: 32px;">
              <h2 style="color: #1f2937; margin-top: 0;">Bonjour ${userName}! 👋</h2>
              
              <p style="color: #4b5563; line-height: 1.6;">
                Vous avez des articles enregistrés dans votre panier AfriShop depuis un moment. 
                Nous voulions vous rappeler qu'ils vous attendent toujours!
              </p>
              
              <p style="color: #4b5563; line-height: 1.6;">
                <strong>You have items saved for later in your AfriShop cart.</strong> 
                We wanted to remind you they're still waiting for you!
              </p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
                <thead>
                  <tr style="background-color: #f9fafb;">
                    <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Product</th>
                    <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Store</th>
                    <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151;">Price</th>
                    <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" style="padding: 12px; font-weight: 600; color: #1f2937;">Total Value:</td>
                    <td colspan="2" style="padding: 12px; font-weight: 600; color: #1e40af; text-align: right;">$${totalValue.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
              
              <div style="text-align: center; margin: 32px 0;">
                <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">
                  Revenez finaliser votre achat dans l'application AfriShop.<br>
                  <em>Come back to complete your purchase in the AfriShop app.</em>
                </p>
              </div>
            </div>
            
            <div style="background-color: #f9fafb; padding: 24px; text-align: center;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} AfriShop. All rights reserved.<br>
                USA to DRC E-commerce Platform
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Send email
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <noreply@afrishop.com>',
            to: [userEmail],
            subject: 'Vous avez des articles enregistrés dans votre panier AfriShop 🛒',
            html: emailHtml,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[saved-cart-reminders] Email failed for:', userEmail, errorText);
          errorCount++;
        } else {
          console.log('[saved-cart-reminders] Email sent to:', userEmail);
          emailSentCount++;
          items.forEach(item => itemsToUpdate.push(item.id));
        }
      } catch (err: any) {
        console.error('[saved-cart-reminders] Email error for:', userEmail, err.message);
        errorCount++;
      }

      // Send push notification
      try {
        const pushResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: userId,
              title: 'Articles enregistrés 🛒',
              body: `Vous avez ${items.length} article(s) enregistré(s) ($${totalValue.toFixed(2)}). Revenez finaliser votre achat!`,
              data: {
                type: 'saved_cart_reminder',
                itemCount: items.length,
                totalValue: totalValue.toFixed(2),
              },
            }),
          }
        );

        if (pushResponse.ok) {
          const pushResult = await pushResponse.json();
          if (pushResult.sent > 0) {
            pushSentCount++;
            console.log('[saved-cart-reminders] Push sent to:', userId, pushResult);
          }
        } else {
          console.log('[saved-cart-reminders] Push failed for:', userId);
        }
      } catch (pushErr: any) {
        console.log('[saved-cart-reminders] Push error for:', userId, pushErr.message);
      }
    }

    // Update last_reminder_at for all sent items
    if (itemsToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from('order_items')
        .update({ last_reminder_at: now.toISOString() })
        .in('id', itemsToUpdate);

      if (updateError) {
        console.error('[saved-cart-reminders] Error updating reminder timestamps:', updateError);
      } else {
        console.log('[saved-cart-reminders] Updated reminder timestamps for items:', itemsToUpdate.length);
      }
    }

    console.log('[saved-cart-reminders] Job completed:', { emailSentCount, pushSentCount, errorCount });

    return new Response(
      JSON.stringify({ 
        success: true,
        emailsSent: emailSentCount,
        pushSent: pushSentCount,
        errors: errorCount,
        itemsUpdated: itemsToUpdate.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[saved-cart-reminders] Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
