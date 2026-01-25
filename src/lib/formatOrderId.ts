/**
 * Format order ID to a more meaningful format
 * Format: AFRI-{CustomerFirstName}-{ShortID}
 * Example: AFRI-JEAN-8D4F
 */
export function formatOrderId(orderId: string, customerName?: string | null): string {
  const shortId = orderId.slice(0, 4).toUpperCase();
  const firstName = customerName?.split(' ')[0]?.toUpperCase().slice(0, 8) || 'GUEST';
  // Remove any special characters from the name
  const sanitizedName = firstName.replace(/[^A-Z]/g, '');
  return `AFRI-${sanitizedName || 'GUEST'}-${shortId}`;
}

/**
 * Get just the short ID part
 */
export function getShortOrderId(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
