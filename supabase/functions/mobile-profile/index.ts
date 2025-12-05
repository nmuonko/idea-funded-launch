import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { isProfileComplete, getMissingProfileFields } from "../_shared/profileHelper.ts";

/**
 * Mobile Profile GET Endpoint
 * 
 * Returns the authenticated user's profile information.
 * Used by mobile app to display profile and pre-fill checkout.
 * NOTE: postalCode removed - not used in African countries.
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
 *     "country": "...",
 *     "language": "fr" | "en" | "sw" | "ln"
 *   },
 *   "hasCompleteProfile": true/false,
 *   "missingFields": [] // only present if profile incomplete
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
          country: '',
          language: 'fr',
        },
        hasCompleteProfile: false,
        missingFields: getMissingProfileFields(null),
      });
    }

    // Check if profile is complete using shared helper
    const hasCompleteProfile = isProfileComplete(profile);
    const missingFields = hasCompleteProfile ? [] : getMissingProfileFields(profile);

    console.log('[mobile-profile] Profile retrieved, complete:', hasCompleteProfile, 'missing:', missingFields);

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
        country: profile.country || '',
        language: profile.language || 'fr',
      },
      hasCompleteProfile,
      missingFields,
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
