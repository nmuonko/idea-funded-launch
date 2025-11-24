/**
 * Generate a unique AfriFund confirmation ID
 * Format: AFF-YYYYMMDD-XXXXXXXX
 * Example: AFF-20251124-A7C93F2B
 */
export function generateConfirmationId(): string {
  // Get current date in YYYYMMDD format
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // Generate random suffix (8 characters, uppercase A-Z and 0-9)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `AFF-${dateStr}-${suffix}`;
}
