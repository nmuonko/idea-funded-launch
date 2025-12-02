import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  handleCors, 
  getAuthenticatedUser, 
  AuthError, 
  errorResponse, 
  jsonResponse,
  corsHeaders 
} from "../_shared/auth.ts";

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('[auth-me] Processing request...');
    
    // Get authenticated user using shared utility
    const { user, supabase } = await getAuthenticatedUser(req);
    
    console.log('[auth-me] User authenticated:', user.email);

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, phone, full_name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn('[auth-me] Profile fetch error (non-fatal):', profileError.message);
    }

    const response = {
      user: {
        id: user.id,
        email: user.email,
        name: profile?.name || profile?.full_name || null,
        phone: profile?.phone || null,
      },
    };

    console.log('[auth-me] Success, returning user data');
    return jsonResponse(response);

  } catch (error: any) {
    console.error('[auth-me] Error:', error.message);
    
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
