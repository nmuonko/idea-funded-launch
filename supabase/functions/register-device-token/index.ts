import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[register-device-token] User authenticated:', user.id);

    const { deviceToken, platform } = await req.json();

    if (!deviceToken || !platform) {
      return errorResponse('Missing deviceToken or platform', 400);
    }

    if (platform !== 'ios' && platform !== 'android') {
      return errorResponse('Platform must be ios or android', 400);
    }

    console.log('[register-device-token] Registering token for user:', user.id, 'platform:', platform);

    // Upsert device token
    const { data, error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: user.id,
        device_token: deviceToken,
        platform: platform,
        last_used_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,device_token'
      })
      .select()
      .single();

    if (error) {
      console.error('[register-device-token] Error upserting token:', error);
      throw error;
    }

    console.log('[register-device-token] Token registered successfully:', data.id);

    return jsonResponse({ 
      success: true,
      tokenId: data.id
    });

  } catch (error: any) {
    console.error('[register-device-token] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
