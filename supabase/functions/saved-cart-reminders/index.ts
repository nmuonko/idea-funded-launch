import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tiered reminder schedule (in hours since saved_at)
const REMINDER_TIERS = [
  { tier: 1, hoursThreshold: 24, subject: "N'oubliez pas vos articles! 🛒", tone: "friendly" },
  { tier: 2, hoursThreshold: 72, subject: "Vos articles vous attendent toujours 💫", tone: "reminder" },
  { tier: 3, hoursThreshold: 168, subject: "Toujours intéressé(e)? 🤔", tone: "inquiry" },
  { tier: 4, hoursThreshold: 336, subject: "Dernière chance avant suppression ⏰", tone: "urgent" },
  { tier: 5, hoursThreshold: 504, subject: "Dernier rappel - Articles bientôt supprimés 🚨", tone: "final" },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[saved-cart-reminders] Starting tiered reminder job');

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

    // Find users with saved items
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
        reminder_count,
        orders!inner(
          id,
          user_id,
          status
        )
      `)
      .eq('is_saved_for_later', true)
      .eq('orders.status', 'DRAFT')
      .not('saved_at', 'is', null);

    if (itemsError) {
      console.error('[saved-cart-reminders] Error fetching saved items:', itemsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch saved items' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!savedItems || savedItems.length === 0) {
      console.log('[saved-cart-reminders] No saved items found');
      return new Response(
        JSON.stringify({ message: 'No reminders to send', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which items need reminders based on tier
    const itemsNeedingReminder: { item: any; tier: typeof REMINDER_TIERS[0] }[] = [];

    for (const item of savedItems) {
      const savedAt = new Date(item.saved_at);
      const hoursSinceSaved = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);
      const currentReminderCount = item.reminder_count || 0;

      // Find the next applicable tier
      const nextTier = REMINDER_TIERS.find(t => 
        t.tier === currentReminderCount + 1 && hoursSinceSaved >= t.hoursThreshold
      );

      if (nextTier) {
        // Check cooldown - at least 24h since last reminder
        if (item.last_reminder_at) {
          const lastReminder = new Date(item.last_reminder_at);
          const hoursSinceLastReminder = (now.getTime() - lastReminder.getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastReminder < 24) continue;
        }
        
        itemsNeedingReminder.push({ item, tier: nextTier });
      }
    }

    console.log('[saved-cart-reminders] Items needing reminders:', itemsNeedingReminder.length);

    if (itemsNeedingReminder.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No reminders due at this time', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group items by user
    const userItemsMap = new Map<string, { items: any[]; tier: typeof REMINDER_TIERS[0] }>();
    
    for (const { item, tier } of itemsNeedingReminder) {
      const userId = (item.orders as any).user_id;
      if (!userItemsMap.has(userId)) {
        userItemsMap.set(userId, { items: [], tier });
      }
      userItemsMap.get(userId)!.items.push(item);
      // Use the highest tier if user has multiple items at different tiers
      if (tier.tier > userItemsMap.get(userId)!.tier.tier) {
        userItemsMap.get(userId)!.tier = tier;
      }
    }

    console.log('[saved-cart-reminders] Users to notify:', userItemsMap.size);

    // Get user profiles and emails
    const userIds = Array.from(userItemsMap.keys());
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, name')
      .in('user_id', userIds);

    const { data: authUsers } = await supabase.auth.admin.listUsers();

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
    const authUserMap = new Map((authUsers?.users || []).map((u: any) => [u.id, u] as [string, any]));

    let emailSentCount = 0;
    let pushSentCount = 0;
    let errorCount = 0;
    const itemsToUpdate: { id: string; newCount: number }[] = [];

    const FRONTEND_BASE_URL = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    // Send emails and push notifications to each user
    for (const [userId, { items, tier }] of userItemsMap) {
      const profile = profileMap.get(userId);
      const authUser = authUserMap.get(userId) as any;
      
      if (!authUser?.email) {
        console.log('[saved-cart-reminders] Skipping user without email:', userId);
        continue;
      }

      const userName = profile?.full_name || profile?.name || 'Valued Customer';
      const userEmail = authUser.email;

      // Build email content based on tier
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

      const totalValue = items.reduce((sum: number, item: any) => 
        sum + (Number(item.base_price_usd || 0) * (item.quantity || 1)), 0
      );

      // Tier-specific messaging
      let urgencyMessage = '';
      let ctaText = 'Finaliser mon achat';
      
      switch (tier.tone) {
        case 'friendly':
          urgencyMessage = "Vous avez des articles enregistrés qui vous attendent!";
          break;
        case 'reminder':
          urgencyMessage = "Ça fait quelques jours que vos articles sont en attente.";
          break;
        case 'inquiry':
          urgencyMessage = "Nous avons remarqué que vous n'avez pas finalisé votre achat. Avez-vous des questions?";
          break;
        case 'urgent':
          urgencyMessage = "⚠️ Vos articles seront bientôt supprimés de votre panier.";
          ctaText = 'Finaliser maintenant';
          break;
        case 'final':
          urgencyMessage = "🚨 DERNIER RAPPEL: Vos articles seront supprimés dans les prochaines 48 heures.";
          ctaText = 'Acheter immédiatement';
          break;
      }

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
              
              <p style="color: #4b5563; line-height: 1.6; font-size: 16px; ${tier.tone === 'urgent' || tier.tone === 'final' ? 'color: #dc2626; font-weight: bold;' : ''}">
                ${urgencyMessage}
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
                <a href="${FRONTEND_BASE_URL}/orders" style="display: inline-block; background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                  ${ctaText}
                </a>
              </div>
              
              <p style="color: #6b7280; font-size: 14px; text-align: center;">
                Rappel ${tier.tier}/5 • Si vous ne souhaitez plus recevoir ces rappels, ignorez cet email.
              </p>
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
            subject: tier.subject,
            html: emailHtml,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[saved-cart-reminders] Email failed for:', userEmail, errorText);
          errorCount++;
        } else {
          console.log('[saved-cart-reminders] Tier', tier.tier, 'email sent to:', userEmail);
          emailSentCount++;
          items.forEach((item: any) => itemsToUpdate.push({ 
            id: item.id, 
            newCount: (item.reminder_count || 0) + 1 
          }));
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
              title: tier.subject,
              body: `${items.length} article(s) enregistré(s) ($${totalValue.toFixed(2)}). ${tier.tone === 'urgent' || tier.tone === 'final' ? 'Achetez maintenant!' : 'Finalisez votre achat!'}`,
              data: {
                type: 'saved_cart_reminder',
                itemCount: items.length,
                totalValue: totalValue.toFixed(2),
                tier: tier.tier,
              },
            }),
          }
        );

        if (pushResponse.ok) {
          const pushResult = await pushResponse.json();
          if (pushResult.sent > 0) {
            pushSentCount++;
          }
        }
      } catch (pushErr: any) {
        console.log('[saved-cart-reminders] Push error for:', userId, pushErr.message);
      }
    }

    // Update reminder_count and last_reminder_at for all sent items
    for (const { id, newCount } of itemsToUpdate) {
      const { error: updateError } = await supabase
        .from('order_items')
        .update({ 
          last_reminder_at: now.toISOString(),
          reminder_count: newCount
        })
        .eq('id', id);

      if (updateError) {
        console.error('[saved-cart-reminders] Error updating item:', id, updateError);
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
