import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  jsonResponse 
} from "../_shared/auth.ts";

/**
 * Mobile Profile Update Endpoint
 * 
 * Updates the authenticated user's profile information.
 * Only provided fields will be updated.
 * NOTE: postalCode field removed - not used in African countries.
 * 
 * PATCH /mobile-profile-update
 * 
 * Body (all fields optional):
 * {
 *   "fullName": "...",
 *   "phoneNumber": "...",
 *   "addressLine1": "...",
 *   "addressLine2": "...",
 *   "city": "...",
 *   "stateOrProvince": "...",
 *   "country": "...",
 *   "language": "fr" | "en" | "sw" | "ln"
 * }
 */

// Accept ANY of these key formats for each field
interface UpdateProfileRequest {
  // Full name variants
  fullName?: string;
  full_name?: string;
  name?: string;
  // Phone variants
  phoneNumber?: string;
  phone_number?: string;
  phone?: string;
  // Address line 1 variants
  addressLine1?: string;
  address_line1?: string;
  address_line_1?: string;
  // Address line 2 variants
  addressLine2?: string;
  address_line2?: string;
  address_line_2?: string;
  // City
  city?: string;
  // State/Province variants
  stateOrProvince?: string;
  state_or_province?: string;
  stateProvince?: string;
  state_province?: string;
  province?: string;
  // Country
  country?: string;
  // Language
  language?: string;
}

// Normalize incoming keys to get the actual value
function normalizeField<T>(body: Record<string, any>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (body[key] !== undefined) {
      return body[key] as T;
    }
  }
  return undefined;
}

function validatePhone(phone: string): boolean {
  if (!phone || phone.trim() === '') return true; // Allow empty
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length >= 8 && digitsOnly.length <= 15;
}

const VALID_LANGUAGES = ['fr', 'en', 'sw', 'ln'];

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    console.log('[mobile-profile-update] Processing profile update');

    // Verify JWT and get user
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-profile-update] User authenticated:', user.id);

    const body: UpdateProfileRequest = await req.json();
    
    // Normalize all incoming keys to support multiple formats
    const fullName = normalizeField<string>(body, 'fullName', 'full_name', 'name');
    const phoneNumber = normalizeField<string>(body, 'phoneNumber', 'phone_number', 'phone');
    const addressLine1 = normalizeField<string>(body, 'addressLine1', 'address_line1', 'address_line_1');
    const addressLine2 = normalizeField<string>(body, 'addressLine2', 'address_line2', 'address_line_2');
    const city = normalizeField<string>(body, 'city');
    const stateOrProvince = normalizeField<string>(body, 'stateOrProvince', 'state_or_province', 'stateProvince', 'state_province', 'province');
    const country = normalizeField<string>(body, 'country');
    const language = normalizeField<string>(body, 'language');
    
    console.log('[mobile-profile-update] Normalized fields:', { fullName, phoneNumber, addressLine1, city, stateOrProvince, country });

    // Validate phone if provided
    if (phoneNumber && !validatePhone(phoneNumber)) {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid phone number format. Must be between 8 and 15 digits.' 
      }, 400);
    }

    // Validate language if provided
    if (language && !VALID_LANGUAGES.includes(language)) {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid language. Must be one of: fr, en, sw, ln' 
      }, 400);
    }

    // Validate field lengths
    if (fullName && fullName.trim().length > 100) {
      return jsonResponse({ success: false, error: 'Full name must be less than 100 characters' }, 400);
    }
    if (addressLine1 && addressLine1.trim().length > 200) {
      return jsonResponse({ success: false, error: 'Address line 1 must be less than 200 characters' }, 400);
    }
    if (addressLine2 && addressLine2.trim().length > 200) {
      return jsonResponse({ success: false, error: 'Address line 2 must be less than 200 characters' }, 400);
    }
    if (city && city.trim().length > 100) {
      return jsonResponse({ success: false, error: 'City must be less than 100 characters' }, 400);
    }
    if (stateOrProvince && stateOrProvince.trim().length > 100) {
      return jsonResponse({ success: false, error: 'State/Province must be less than 100 characters' }, 400);
    }
    if (country && country.trim().length > 100) {
      return jsonResponse({ success: false, error: 'Country must be less than 100 characters' }, 400);
    }

    // Build update object with only provided fields
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (fullName !== undefined) {
      updateData.full_name = fullName.trim();
      updateData.name = fullName.trim();
    }
    if (phoneNumber !== undefined) updateData.phone = phoneNumber.trim();
    if (addressLine1 !== undefined) updateData.address_line1 = addressLine1.trim();
    if (addressLine2 !== undefined) updateData.address_line2 = addressLine2?.trim() || null;
    if (city !== undefined) updateData.city = city.trim();
    if (stateOrProvince !== undefined) updateData.state_province = stateOrProvince.trim();
    if (country !== undefined) updateData.country = country.trim();
    if (language !== undefined) updateData.language = language;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 1) { // Only updated_at
      return jsonResponse({ 
        success: false, 
        error: 'No fields provided to update' 
      }, 400);
    }

    console.log('[mobile-profile-update] Updating fields:', Object.keys(updateData));

    // Check if profile exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    let profile;
    
    if (existingProfile) {
      // Update existing profile
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('[mobile-profile-update] Update error:', updateError);
        return jsonResponse({ 
          success: false, 
          error: 'Failed to update profile' 
        }, 500);
      }
      profile = updatedProfile;
    } else {
      // Create new profile
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          email: user.email,
          ...updateData,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[mobile-profile-update] Insert error:', insertError);
        return jsonResponse({ 
          success: false, 
          error: 'Failed to create profile' 
        }, 500);
      }
      profile = newProfile;
    }

    // Check if profile is now complete (postal_code removed from requirements)
    const hasCompleteProfile = !!(
      profile.full_name &&
      profile.phone &&
      profile.address_line1 &&
      profile.city &&
      profile.country
    );

    console.log('[mobile-profile-update] Profile updated, complete:', hasCompleteProfile);

    return jsonResponse({
      success: true,
      message: 'Profile updated successfully',
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
    });

  } catch (error: any) {
    console.error('[mobile-profile-update] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({ success: false, error: error.message }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      error: 'Failed to update profile',
    }, 500);
  }
});
