import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";
import { 
  isProfileComplete, 
  getMissingProfileFields,
  getLanguageForCountry,
  createDefaultProfile 
} from "../_shared/profileHelper.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Mobile Profile GET Endpoint
 * 
 * Returns the authenticated user's profile information.
 * Auto-creates profile with defaults if none exists.
 * 
 * GET /mobile-profile
 * 
 * Response:
 * {
 *   "id": "...",
 *   "email": "...",
 *   "full_name": "...",
 *   "phone": "...",
 *   "address": "...",
 *   "country": "...",
 *   "province": "...",
 *   "language": "fr" | "en" | "sw" | "ln",
 *   "hasCompleteProfile": true/false,
 *   "missingFields": []
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

    // Use service role for profile creation if needed
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch user profile
    let { data: profile, error: profileError } = await supabaseAdmin
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

    // If no profile exists, create one with defaults
    if (!profile) {
      console.log('[mobile-profile] No profile found, creating default profile');
      
      const defaultCountry = 'DR Congo';
      const defaultProvince = 'Kinshasa';
      const defaultLanguage = getLanguageForCountry(defaultCountry);
      
      const newProfile = {
        user_id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        phone: '',
        address: '',
        country: defaultCountry,
        province: defaultProvince,
        language: defaultLanguage,
      };

      const { data: createdProfile, error: createError } = await supabaseAdmin
        .from('profiles')
        .upsert(newProfile, { onConflict: 'user_id' })
        .select()
        .single();

      if (createError) {
        console.error('[mobile-profile] Failed to create profile:', createError);
        // Return default profile anyway
        profile = newProfile as any;
      } else {
        profile = createdProfile;
        console.log('[mobile-profile] Created default profile successfully');
      }
    }

    // Check if profile is complete
    const hasCompleteProfile = isProfileComplete(profile);
    const missingFields = hasCompleteProfile ? [] : getMissingProfileFields(profile);

    console.log('[mobile-profile] Profile retrieved, complete:', hasCompleteProfile);

    // Return profile in the new simplified format
    return jsonResponse({
      id: profile.user_id || user.id,
      email: profile.email || user.email || '',
      full_name: profile.full_name || profile.name || '',
      phone: profile.phone || '',
      address: profile.address || profile.address_line1 || '',
      country: profile.country || 'DR Congo',
      province: profile.province || profile.state_province || 'Kinshasa',
      language: profile.language || 'fr',
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
