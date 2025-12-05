/**
 * Shared Profile Helper Functions
 * 
 * Used by auth-register, mobile-checkout, mobile-profile, etc.
 * to ensure consistent profile completeness checks.
 */

export interface UserProfile {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
  language?: string | null;
}

/**
 * Required fields for a complete profile that can proceed to checkout.
 * NOTE: postal_code removed - not used in African countries.
 */
const REQUIRED_PROFILE_FIELDS = [
  'full_name',
  'phone',
  'address_line1',
  'city',
  'country',
] as const;

/**
 * Check if a profile has all required fields filled out.
 * Returns true if the profile is complete for checkout.
 */
export function isProfileComplete(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  
  return REQUIRED_PROFILE_FIELDS.every(field => {
    const value = profile[field as keyof UserProfile];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

/**
 * Get list of missing profile fields (for error messages).
 * Returns camelCase field names for API consistency.
 */
export function getMissingProfileFields(profile: UserProfile | null | undefined): string[] {
  if (!profile) {
    return ['fullName', 'phoneNumber', 'addressLine1', 'city', 'country'];
  }
  
  const fieldMap: Record<string, string> = {
    full_name: 'fullName',
    phone: 'phoneNumber',
    address_line1: 'addressLine1',
    city: 'city',
    country: 'country',
  };
  
  const missing: string[] = [];
  
  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = profile[field as keyof UserProfile];
    if (value === null || value === undefined || String(value).trim() === '') {
      missing.push(fieldMap[field] || field);
    }
  }
  
  return missing;
}

/**
 * Format profile data for API response (camelCase).
 * NOTE: postalCode removed from response.
 */
export function formatProfileForResponse(profile: UserProfile | null | undefined): {
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateOrProvince: string | null;
  country: string | null;
  language: string | null;
} | null {
  if (!profile) return null;
  
  return {
    fullName: profile.full_name || null,
    email: profile.email || null,
    phoneNumber: profile.phone || null,
    addressLine1: profile.address_line1 || null,
    addressLine2: profile.address_line2 || null,
    city: profile.city || null,
    stateOrProvince: profile.state_province || null,
    country: profile.country || null,
    language: profile.language || 'fr',
  };
}
