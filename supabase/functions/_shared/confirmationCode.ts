/**
 * Generate a unique AfriShop confirmation code
 * Format: AFS-XXXX-XXXX
 * Example: AFS-8X3P-92QD
 * 
 * Uses alphanumeric characters excluding confusing ones: 0, 1, O, I, L
 */

// Characters to use (excluding 0, 1, O, I, L to avoid confusion)
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRandomChars(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}

export function generateConfirmationCode(): string {
  const part1 = generateRandomChars(4);
  const part2 = generateRandomChars(4);
  return `AFS-${part1}-${part2}`;
}

/**
 * Validate a confirmation code format
 */
export function isValidConfirmationCode(code: string): boolean {
  const pattern = /^AFS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
  return pattern.test(code);
}
