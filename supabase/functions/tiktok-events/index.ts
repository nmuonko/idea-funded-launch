// TikTok Events API server-side relay
// Receives events from the frontend and forwards them to TikTok's server-to-server API
// for deduplication with the browser pixel.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
const PIXEL_ID = 'D76IOI3C77U5P0Q2C2AG';

interface TikTokEventPayload {
  event: string;
  event_id: string;
  event_time: number;
  user: {
    email?: string;
    phone_number?: string;
    external_id?: string;
    ip?: string;
    user_agent?: string;
  };
  properties: {
    value?: number;
    currency?: string;
    content_id?: string;
    content_type?: string;
    content_name?: string;
    search_string?: string;
    contents?: Array<{ content_id: string; content_name?: string; price?: number; quantity?: number }>;
  };
}

// SHA-256 hash helper (TikTok requires hashed PII)
async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const accessToken = Deno.env.get('TIKTOK_EVENTS_API_TOKEN');
  if (!accessToken) {
    console.error('[tiktok-events] TIKTOK_EVENTS_API_TOKEN not configured');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const {
      event,
      event_id,
      properties = {},
      user_email,
      user_phone,
      user_id,
    } = body as {
      event: string;
      event_id: string;
      properties?: Record<string, any>;
      user_email?: string;
      user_phone?: string;
      user_id?: string;
    };

    if (!event || !event_id) {
      return new Response(JSON.stringify({ error: 'event and event_id are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Allow-list of supported event names to prevent analytics pollution.
    const ALLOWED_EVENTS = new Set([
      'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase',
      'CompletePayment', 'Search', 'AddToWishlist', 'Registration', 'Login',
    ]);
    if (!ALLOWED_EVENTS.has(event)) {
      return new Response(JSON.stringify({ error: 'unsupported_event' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (typeof event_id !== 'string' || event_id.length > 128) {
      return new Response(JSON.stringify({ error: 'invalid_event_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Clamp numeric value to a reasonable range.
    if (properties && typeof properties.value !== 'undefined') {
      const v = Number(properties.value);
      if (!Number.isFinite(v) || v < 0 || v > 1_000_000) {
        delete properties.value;
      } else {
        properties.value = v;
      }
    }

    // Build user object with hashed PII
    const userObj: TikTokEventPayload['user'] = {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          req.headers.get('x-real-ip') ||
          req.headers.get('cf-connecting-ip') ||
          undefined,
      user_agent: req.headers.get('user-agent') || undefined,
    };

    if (user_email) {
      userObj.email = await sha256(user_email);
    }
    if (user_phone) {
      userObj.phone_number = await sha256(user_phone);
    }
    if (user_id) {
      userObj.external_id = await sha256(user_id);
    }

    // Build the event payload
    const eventData: TikTokEventPayload = {
      event,
      event_id,
      event_time: Math.floor(Date.now() / 1000),
      user: userObj,
      properties: {
        currency: properties.currency || 'USD',
        ...(properties.value != null && { value: properties.value }),
        ...(properties.content_id && { content_id: properties.content_id }),
        ...(properties.content_type && { content_type: properties.content_type }),
        ...(properties.content_name && { content_name: properties.content_name }),
        ...(properties.search_string && { search_string: properties.search_string }),
        // TikTok requires contents array for Content ID matching
        contents: properties.contents || (properties.content_id
          ? [{ content_id: properties.content_id, content_name: properties.content_name || '', content_type: properties.content_type || 'product', price: properties.value, quantity: 1 }]
          : undefined),
      },
    };

    // Send to TikTok Events API
    const ttResponse = await fetch(TIKTOK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': accessToken,
      },
      body: JSON.stringify({
        pixel_code: PIXEL_ID,
        event_source: 'web',
        event_source_id: PIXEL_ID,
        data: [eventData],
      }),
    });

    const ttResult = await ttResponse.json();

    if (ttResult.code !== 0) {
      console.error('[tiktok-events] TikTok API error:', JSON.stringify(ttResult));
      return new Response(JSON.stringify({ ok: false, tiktok_code: ttResult.code, tiktok_message: ttResult.message }), {
        status: 200, // Don't fail the client request
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[tiktok-events] ${event} sent OK, event_id=${event_id}`);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[tiktok-events] Error:', err.message);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
