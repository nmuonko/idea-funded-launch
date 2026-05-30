 /**
  * Centralized support contact configuration
  * These values are used across the web app for contact widgets and support links
  */
 
 // Support WhatsApp number in E.164 format (no + prefix for wa.me links)
 export const SUPPORT_WHATSAPP_E164 = '243973141627';
 
 // Support email address
 export const SUPPORT_EMAIL = 'nkadimisha@afrishop-usa.com';
 
 // Formatted WhatsApp number for display
 export const SUPPORT_WHATSAPP_DISPLAY = '+243 973 141 627';
 
 /**
  * Generate WhatsApp URL with pre-filled message
  */
export function getWhatsAppUrl(_userEmail?: string | null): string {
   const message = `Bonjour L'Équipe AfriShop,\nJe suis prêt à commander. Si j'ai un souci avant le paiement, j'aurai besoin de votre aide.`;
   return `https://wa.me/${SUPPORT_WHATSAPP_E164}?text=${encodeURIComponent(message)}`;
 }
 
 /**
  * Generate mailto URL with pre-filled subject and body
  */
 export function getEmailUrl(userEmail?: string | null): string {
   const subject = 'AfriShop Support Request';
   const body = `Hello AfriShop Support Team,\n\nI need assistance with my order.\n\nMy account email: ${userEmail || 'Not logged in'}\n\nPlease describe your issue below:\n\n`;
   return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
 }