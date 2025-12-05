import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

/**
 * Mobile Profile GET Endpoint
 * 
 * Returns the authenticated user's profile information.
 * Used by mobile app to display profile and pre-fill checkout.
 * 
 * GET /mobile-profile
 * 
 * Response:
 * {
 *   "success": true,
 *   "profile": {
 *     "email": "...",
 *     "fullName": "...",
 *     "phoneNumber": "...",
 *     "addressLine1": "...",
 *     "addressLine2": "...",
 *     "city": "...",
 *     "stateOrProvince": "...",
 *     "postalCode": "...",
 *     "country": "..."
 *   }
 * }
 */

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'GET') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-profile] Fetching user profile');

    // Verify JWT and get user
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-profile] User authenticated:', user.id);

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[mobile-profile] Error fetching profile:', profileError);
      return jsonResponse({ 
        success: false, 
        error: 'Failed to fetch profile' 
      }, 500);
    }

    // If no profile exists, return empty profile structure
    if (!profile) {
      console.log('[mobile-profile] No profile found, returning empty structure');
      return jsonResponse({
        success: true,
        profile: {
          email: user.email || '',
          fullName: '',
          phoneNumber: '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          stateOrProvince: '',
          postalCode: '',
          country: '',
        },
        hasCompleteProfile: false,
      });
    }

    // Check if profile is complete (has all required fields)
    const hasCompleteProfile = !!(
      profile.full_name &&
      profile.phone &&
      profile.address_line1 &&
      profile.city &&
      profile.state_province &&
      profile.postal_code &&
      profile.country
    );

    console.log('[mobile-profile] Profile retrieved, complete:', hasCompleteProfile);

    return jsonResponse({
      success: true,
      profile: {
        email: profile.email || user.email || '',
        fullName: profile.full_name || profile.name || '',
        phoneNumber: profile.phone || '',
        addressLine1: profile.address_line1 || '',
        addressLine2: profile.address_line2 || '',
        city: profile.city || '',
        stateOrProvince: profile.state_province || '',
        postalCode: profile.postal_code || '',
        country: profile.country || '',
      },
      hasCompleteProfile,
    });

  } catch (error: any) {
    console.error('[mobile-profile] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'Failed to fetch profile',
    }, 500);
  }
});
