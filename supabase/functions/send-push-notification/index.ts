import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY');
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID');
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID');
const APNS_AUTH_KEY = Deno.env.get('APNS_AUTH_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { userId, title, body, data } = await req.json();

    if (!userId || !title || !body) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-push-notification] Sending push to user:', userId);

    // Get user's device tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('device_tokens')
      .select('*')
      .eq('user_id', userId);

    if (tokensError) {
      console.error('[send-push-notification] Error fetching tokens:', tokensError);
      throw tokensError;
    }

    if (!tokens || tokens.length === 0) {
      console.log('[send-push-notification] No device tokens found for user:', userId);
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No devices to notify',
        sent: 0
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sentCount = 0;
    const errors: any[] = [];

    // Send to each device
    for (const token of tokens) {
      try {
        if (token.platform === 'android' && FCM_SERVER_KEY) {
          // Send via Firebase Cloud Messaging
          const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: {
              'Authorization': `key=${FCM_SERVER_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: token.device_token,
              notification: {
                title: title,
                body: body,
                sound: 'default',
              },
              data: data || {},
            }),
          });

          if (fcmResponse.ok) {
            sentCount++;
            console.log('[send-push-notification] FCM sent successfully to:', token.id);
          } else {
            const errorText = await fcmResponse.text();
            console.error('[send-push-notification] FCM error:', errorText);
            errors.push({ tokenId: token.id, platform: 'android', error: errorText });
          }
        } else if (token.platform === 'ios' && APNS_KEY_ID && APNS_TEAM_ID && APNS_AUTH_KEY) {
          // Send via Apple Push Notification Service
          // Note: This is a simplified example. Production APNS requires JWT token generation
          console.log('[send-push-notification] APNS sending not fully implemented. Token:', token.id);
          // You would need to implement JWT signing for APNS here
          // For now, we'll log it
          errors.push({ 
            tokenId: token.id, 
            platform: 'ios', 
            error: 'APNS not fully implemented' 
          });
        } else {
          console.log('[send-push-notification] Missing credentials for platform:', token.platform);
          errors.push({ 
            tokenId: token.id, 
            platform: token.platform, 
            error: 'Missing platform credentials' 
          });
        }
      } catch (sendError: any) {
        console.error('[send-push-notification] Error sending to token:', token.id, sendError);
        errors.push({ tokenId: token.id, error: sendError.message });
      }
    }

    console.log('[send-push-notification] Sent:', sentCount, 'Failed:', errors.length);

    return new Response(JSON.stringify({ 
      success: true,
      sent: sentCount,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[send-push-notification] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
