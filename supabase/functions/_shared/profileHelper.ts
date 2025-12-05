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
 * Required fields for a complete profile that can proceed to checkout.
 */
const REQUIRED_PROFILE_FIELDS = [
  'full_name',
  'phone',
  'address',
  'country',
  'province',
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
    return ['fullName', 'phone', 'address', 'country', 'province'];
  }
  
  const fieldMap: Record<string, string> = {
    full_name: 'fullName',
    phone: 'phone',
    address: 'address',
    country: 'country',
    province: 'province',
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
    province: profile.province || profile.state_province || 'Kinshasa',
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
    province: overrides?.province || 'Kinshasa',
    language: language,
  };
}
