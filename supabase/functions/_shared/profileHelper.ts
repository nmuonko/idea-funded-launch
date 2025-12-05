/**
 * Shared Profile Helper Functions
 * 
 * Used by auth-register, mobile-checkout, mobile-profile, etc.
 * to ensure consistent profile completeness checks.
 * 
 * Note: For African addresses, we only require full_name, phone, and country
 * since address formats vary widely and province/street may not always apply.
 */

export interface UserProfile {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  province?: string | null;
  language?: string | null;
  // Legacy fields (for backward compatibility)
  name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
}

// French-speaking African countries
export const FRENCH_COUNTRIES = [
  'DR Congo', 'Congo-Brazzaville', 'Central African Republic', 'Cameroon',
  'Burundi', 'Rwanda', 'Benin', 'Ivory Coast', 'Senegal', 'Mali',
  'Chad', 'Niger', 'Gabon', 'Togo', 'Burkina Faso', 'Madagascar',
  'Guinea', 'Mauritius', 'Comoros', 'Djibouti', 'Seychelles'
];

// English-speaking African countries
export const ENGLISH_COUNTRIES = [
  'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'South Africa',
  'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Malawi', 'Liberia',
  'Sierra Leone', 'Gambia', 'Lesotho', 'Eswatini'
];

/**
 * Get default language based on country
 */
export function getLanguageForCountry(country: string): string {
  if (FRENCH_COUNTRIES.includes(country)) return 'fr';
  if (ENGLISH_COUNTRIES.includes(country)) return 'en';
  return 'fr'; // Default to French
}

/**
 * Minimum required fields for checkout.
 * Relaxed for African addresses - only name, phone, and country are required.
 * Address/province are optional since formats vary widely.
 */
const REQUIRED_PROFILE_FIELDS = [
  'full_name',
  'phone',
  'country',
] as const;

/**
 * Check if a profile has all required fields filled out.
 * Returns true if the profile is complete for checkout.
 * 
 * Note: We check both new field names and legacy field names for compatibility.
 */
export function isProfileComplete(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  
  // Check full_name (or fallback to name)
  const hasName = Boolean(
    (profile.full_name && String(profile.full_name).trim()) ||
    (profile.name && String(profile.name).trim())
  );
  
  // Check phone
  const hasPhone = Boolean(profile.phone && String(profile.phone).trim());
  
  // Check country
  const hasCountry = Boolean(profile.country && String(profile.country).trim());
  
  return hasName && hasPhone && hasCountry;
}

/**
 * Get list of missing profile fields (for error messages).
 * Returns camelCase field names for API consistency.
 */
export function getMissingProfileFields(profile: UserProfile | null | undefined): string[] {
  if (!profile) {
    return ['fullName', 'phone', 'country'];
  }
  
  const missing: string[] = [];
  
  // Check full_name (or fallback to name)
  const hasName = Boolean(
    (profile.full_name && String(profile.full_name).trim()) ||
    (profile.name && String(profile.name).trim())
  );
  if (!hasName) missing.push('fullName');
  
  // Check phone
  if (!profile.phone || !String(profile.phone).trim()) {
    missing.push('phone');
  }
  
  // Check country
  if (!profile.country || !String(profile.country).trim()) {
    missing.push('country');
  }
  
  return missing;
}

/**
 * Format profile data for API response (consistent format).
 */
export function formatProfileForResponse(profile: UserProfile | null | undefined): {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  address: string;
  country: string;
  province: string;
  language: string;
} | null {
  if (!profile) return null;
  
  return {
    id: profile.user_id,
    email: profile.email || '',
    full_name: profile.full_name || profile.name || '',
    phone: profile.phone || '',
    address: profile.address || profile.address_line1 || '',
    country: profile.country || 'DR Congo',
    province: profile.province || profile.state_province || profile.city || '',
    language: profile.language || 'fr',
  };
}

/**
 * Create default profile data for a new user
 */
export function createDefaultProfile(userId: string, email: string, overrides?: Partial<UserProfile>): UserProfile {
  const country = overrides?.country || 'DR Congo';
  const language = overrides?.language || getLanguageForCountry(country);
  
  return {
    user_id: userId,
    email: email,
    full_name: overrides?.full_name || email.split('@')[0] || 'User',
    phone: overrides?.phone || '',
    address: overrides?.address || '',
    country: country,
    province: overrides?.province || '',
    language: language,
  };
}
