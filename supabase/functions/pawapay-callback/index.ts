/**
 * pawapay-callback Edge Function
 * 
 * Receives callback notifications from pawaPay for deposit status updates.
 * Configured in pawaPay dashboard as the callback URL for Deposits and Refunds.
 * 
 * SECURITY:
 * - RFC-9421 HTTP Message Signatures verification using pawaPay's public keys
 * - IP allowlist fallback for unsigned requests (sandbox/testing)
 * - Always returns HTTP 200 to prevent retries
 * 
 * IMPORTANT: Must be idempotent - same callback can arrive multiple times.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createAdminClient } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { generateTraceId, logAudit } from "../_shared/auditLog.ts";
import {
  getPaymentByDepositId,
  updatePaymentStatus,
  logPaymentEvent,
  normalizePaymentStatus,
} from "../_shared/paymentProviders.ts";
import { createReferralCommission } from "../_shared/referralCommission.ts";

// ==================== Zod Schemas for Input Validation ====================

/**
 * Schema for pawaPay callback failure reason
 */
const failureReasonSchema = z.object({
  failureCode: z.string().optional(),
  failureMessage: z.string().optional(),
}).optional().nullable();

/**
 * Schema for pawaPay correspondent IDs
 */
const correspondentIdsSchema = z.object({
  operatorId: z.string().optional(),
}).optional().nullable();

/**
 * Schema for pawaPay deposit callback payload
 * Based on pawaPay API documentation
 */
const pawaPayCallbackSchema = z.object({
  depositId: z.string().uuid({ message: 'Invalid depositId format' }).optional(),
  payoutId: z.string().uuid().optional(),
  status: z.enum(['ACCEPTED', 'COMPLETED', 'FAILED', 'SUBMITTED', 'ENQUEUED'], {
    errorMap: () => ({ message: 'Invalid status value' }),
  }),
  amount: z.string().or(z.number()).optional(),
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  correspondent: z.string().optional(),
  payer: z.object({
    type: z.string().optional(),
    address: z.object({
      value: z.string().optional(),
    }).optional(),
  }).optional(),
  customerTimestamp: z.string().optional(),
  created: z.string().optional(),
  receivedByRecipient: z.string().optional(),
  correspondentIds: correspondentIdsSchema,
  failureReason: failureReasonSchema,
  metadata: z.array(z.object({
    fieldName: z.string(),
    fieldValue: z.string(),
  })).optional(),
}).passthrough(); // Allow additional fields for forward compatibility

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, signature, signature-input, content-digest, signature-date',
};

// ==================== OFFICIAL pawaPay Callback IP Addresses ====================
// Source: pawaPay documentation - https://docs.pawapay.io
// ONLY official IPs - no broad ranges or observed IPs
const PAWAPAY_CALLBACK_IPS = {
  sandbox: [
    '3.64.89.224/32',
  ],
  production: [
    '18.192.208.15/32',
    '18.195.113.136/32',
    '3.72.212.107/32',
    '54.73.125.42/32',
    '54.155.38.214/32',
    '54.73.130.113/32',
  ],
};

// ==================== Configuration ====================

interface CallbackSecurityConfig {
  env: 'sandbox' | 'production';
  verifySignatures: boolean;
  allowUnsignedWithIpCheck: boolean;
}

function getSecurityConfig(): CallbackSecurityConfig {
  // Derive env from PAWAPAY_BASE_URL (canonical source of truth, matches adapter).
  // Fallback to PAWAPAY_ENV, then default to 'production' (safer than sandbox).
  const baseUrl = (Deno.env.get('PAWAPAY_BASE_URL') || '').toLowerCase();
  let env: 'sandbox' | 'production';
  if (baseUrl.includes('sandbox')) {
    env = 'sandbox';
  } else if (baseUrl.includes('pawapay.io')) {
    env = 'production';
  } else {
    env = (Deno.env.get('PAWAPAY_ENV') === 'sandbox' ? 'sandbox' : 'production');
  }
  const verifySignatures = Deno.env.get('PAWAPAY_VERIFY_SIGNATURES') !== 'false'; // Default true
  const allowUnsignedWithIpCheck = Deno.env.get('PAWAPAY_ALLOW_UNSIGNED_WITH_IP_CHECK') !== 'false'; // Default true
  
  console.log('[pawapay-callback] security_config:', { env, verifySignatures, allowUnsignedWithIpCheck, baseUrlDomain: baseUrl ? new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).hostname : 'N/A' });
  return { env, verifySignatures, allowUnsignedWithIpCheck };
}

// ==================== IPv4 CIDR Matching ====================

/**
 * Convert IPv4 address string to 32-bit integer
 */
function ipv4ToInt(ip: string): number {
  // Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const normalized = ip.replace(/^::ffff:/i, '');
  
  const parts = normalized.split('.');
  if (parts.length !== 4) {
    return -1; // Invalid IPv4
  }
  
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const octet = parseInt(parts[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return -1; // Invalid octet
    }
    result = (result << 8) | octet;
  }
  
  // JavaScript bitwise ops return signed 32-bit, convert to unsigned
  return result >>> 0;
}

/**
 * Check if an IP matches a CIDR range (supports /32 to /0)
 */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Parse CIDR notation
  let baseIp: string;
  let prefixBits: number;
  
  if (cidr.includes('/')) {
    const [base, bits] = cidr.split('/');
    baseIp = base;
    prefixBits = parseInt(bits, 10);
    
    if (isNaN(prefixBits) || prefixBits < 0 || prefixBits > 32) {
      console.warn('[pawapay-callback] Invalid CIDR prefix:', cidr);
      return false;
    }
  } else {
    // No prefix means /32 (exact match)
    baseIp = cidr;
    prefixBits = 32;
  }
  
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(baseIp);
  
  if (ipInt === -1 || baseInt === -1) {
    return false;
  }
  
  // Create netmask: for /24 -> 0xFFFFFF00
  // For /32 -> 0xFFFFFFFF
  // For /0 -> 0x00000000
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  
  // Compare masked values
  return (ipInt & mask) === (baseInt & mask);
}

// ==================== IP Verification ====================

/**
 * Extract client IP from request headers
 * Priority: x-forwarded-for (first IP), cf-connecting-ip, x-real-ip
 */
function getClientIp(req: Request): string {
  // x-forwarded-for takes priority - use FIRST IP (original client)
  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(',')[0].trim();
    // Normalize IPv4-mapped IPv6
    return firstIp.replace(/^::ffff:/i, '');
  }
  
  // Cloudflare connecting IP
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.replace(/^::ffff:/i, '');
  }
  
  // nginx/reverse proxy real IP
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) {
    return xRealIp.replace(/^::ffff:/i, '');
  }
  
  return 'unknown';
}

/**
 * Check if IP is in official pawaPay allowlist
 * Checks BOTH sandbox and production lists (pawaPay may use shared infra)
 */
function isAllowedIp(ip: string, _env: 'sandbox' | 'production'): boolean {
  // Combine all official IPs
  const allCidrs = [
    ...PAWAPAY_CALLBACK_IPS.sandbox,
    ...PAWAPAY_CALLBACK_IPS.production,
  ];
  
  const isAllowed = allCidrs.some(cidr => ipMatchesCidr(ip, cidr));
  
  if (!isAllowed) {
    console.warn('[pawapay-callback] IP_REJECTED:', {
      receivedIp: ip,
      allowedCidrs: allCidrs,
      reason: 'ip_not_in_official_allowlist',
    });
  }
  
  return isAllowed;
}

// ==================== RFC-9421 Signature Verification ====================
// Note: Full RFC-9421 implementation requires fetching public keys from pawaPay
// and performing cryptographic verification. This is a simplified implementation.

interface PublicKey {
  keyId: string;
  algorithm: string;
  publicKey: string;
  validFrom: string;
  validUntil?: string;
}

let cachedPublicKeys: PublicKey[] | null = null;
let publicKeysCacheExpiry = 0;

async function fetchPawaPayPublicKeys(config: CallbackSecurityConfig): Promise<PublicKey[]> {
  const now = Date.now();
  
  // Return cached keys if valid (cache for 1 hour)
  if (cachedPublicKeys && now < publicKeysCacheExpiry) {
    return cachedPublicKeys;
  }
  
  const baseUrl = config.env === 'production' 
    ? 'https://api.pawapay.io' 
    : 'https://api.sandbox.pawapay.io';
  
  try {
    const response = await fetch(`${baseUrl}/public-keys`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('[pawapay-callback] Failed to fetch public keys:', response.status);
      return [];
    }
    
    const data = await response.json();
    const keys: PublicKey[] = data.keys || data || [];
    cachedPublicKeys = keys;
    publicKeysCacheExpiry = now + 3600000; // Cache for 1 hour
    
    console.log('[pawapay-callback] Fetched public keys:', keys.length);
    return keys;
  } catch (error) {
    console.error('[pawapay-callback] Error fetching public keys:', error);
    return cachedPublicKeys || [];
  }
}

/**
 * Verify Content-Digest header (RFC-9530)
 * Ensures the request body hasn't been tampered with
 */
async function verifyContentDigest(rawBody: string, contentDigest: string | null): Promise<boolean> {
  if (!contentDigest) {
    return false;
  }
  
  try {
    // pawaPay uses SHA-512 for Content-Digest (per their docs)
    // Support both SHA-256 and SHA-512 for forward compatibility
    const sha512Match = contentDigest.match(/sha-512=:([A-Za-z0-9+/=]+):/);
    const sha256Match = contentDigest.match(/sha-256=:([A-Za-z0-9+/=]+):/);
    
    let expectedDigest: string;
    let algorithm: 'SHA-256' | 'SHA-512';
    
    if (sha512Match) {
      expectedDigest = sha512Match[1];
      algorithm = 'SHA-512';
    } else if (sha256Match) {
      expectedDigest = sha256Match[1];
      algorithm = 'SHA-256';
    } else {
      console.warn('[pawapay-callback] Unsupported Content-Digest algorithm. Expected sha-256 or sha-512.');
      return false;
    }
    
    const encoder = new TextEncoder();
    const data = encoder.encode(rawBody);
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    const hashArray = new Uint8Array(hashBuffer);
    const actualDigest = btoa(String.fromCharCode(...hashArray));
    
    const isValid = expectedDigest === actualDigest;
    if (!isValid) {
      console.warn('[pawapay-callback] Content-Digest mismatch', { algorithm });
    }
    return isValid;
  } catch (error) {
    console.error('[pawapay-callback] Content-Digest verification error:', error);
    return false;
  }
}

/**
 * Verify RFC-9421 HTTP Message Signature
 * This is a simplified implementation - full implementation requires:
 * 1. Parsing Signature-Input to get covered components
 * 2. Reconstructing the signature base
 * 3. Verifying with the appropriate public key
 */
async function verifySignature(
  req: Request,
  rawBody: string,
  config: CallbackSecurityConfig
): Promise<{ valid: boolean; reason: string }> {
  const signature = req.headers.get('signature');
  const signatureInput = req.headers.get('signature-input');
  const contentDigest = req.headers.get('content-digest');
  
  // If no signature headers, request is unsigned
  if (!signature && !signatureInput) {
    return { valid: false, reason: 'unsigned' };
  }
  
  // Both Signature and Signature-Input are required for RFC-9421
  if (!signature || !signatureInput) {
    return { valid: false, reason: 'incomplete_signature_headers' };
  }
  
  // Verify Content-Digest first (body integrity)
  if (contentDigest) {
    const digestValid = await verifyContentDigest(rawBody, contentDigest);
    if (!digestValid) {
      return { valid: false, reason: 'content_digest_mismatch' };
    }
  }
  
  // Fetch public keys
  const publicKeys = await fetchPawaPayPublicKeys(config);
  if (publicKeys.length === 0) {
    console.warn('[pawapay-callback] No public keys available for verification');
    return { valid: false, reason: 'no_public_keys' };
  }
  
  // Parse Signature-Input to extract keyId and covered components
  // Format: sig1=("@method" "@target-uri" "content-digest");keyid="key-id";alg="ecdsa-p256-sha256";created=1234567890
  const keyIdMatch = signatureInput.match(/keyid="([^"]+)"/);
  if (!keyIdMatch) {
    return { valid: false, reason: 'missing_keyid' };
  }
  
  const keyId = keyIdMatch[1];
  const publicKey = publicKeys.find(k => k.keyId === keyId);
  
  if (!publicKey) {
    console.warn('[pawapay-callback] Public key not found for keyId:', keyId);
    return { valid: false, reason: 'unknown_keyid' };
  }

  // ============================================
  // RFC-9421 Full Cryptographic Verification
  // ============================================
  try {
    // 1. Parse covered components from Signature-Input
    // e.g. sig1=("@method" "@target-uri" "content-digest");keyid="...";alg="...";created=...
    const componentsMatch = signatureInput.match(/sig\d+=\(([^)]+)\)/);
    if (!componentsMatch) {
      console.warn('[pawapay-callback] Cannot parse covered components from Signature-Input');
      return { valid: false, reason: 'invalid_signature_input_format' };
    }

    const coveredComponents = componentsMatch[1]
      .split(/\s+/)
      .map(c => c.replace(/"/g, ''))
      .filter(Boolean);

    // 2. Extract created and other params
    const createdMatch = signatureInput.match(/created=(\d+)/);
    const algMatch = signatureInput.match(/alg="([^"]+)"/);

    // 3. Build signature base string per RFC-9421 §2.5
    // pawaPay callback covered components: @method, @authority, @path, signature-date, content-digest, content-type
    const url = new URL(req.url);
    const signatureBaseLines: string[] = [];

    for (const component of coveredComponents) {
      let value: string;
      switch (component) {
        case '@method':
          value = req.method.toUpperCase();
          break;
        case '@target-uri':
          value = req.url;
          break;
        case '@path':
          value = url.pathname;
          break;
        case '@authority':
          value = url.host;
          break;
        case '@scheme':
          value = url.protocol.replace(':', '');
          break;
        case 'content-digest':
          value = contentDigest || '';
          break;
        case 'content-type':
          value = req.headers.get('content-type') || '';
          break;
        case 'content-length':
          value = req.headers.get('content-length') || '';
          break;
        case 'signature-date':
          // pawaPay-specific header included in signature base
          value = req.headers.get('signature-date') || '';
          break;
        default:
          // Generic header lookup
          value = req.headers.get(component) || '';
          break;
      }
      signatureBaseLines.push(`"${component}": ${value}`);
    }

    // Add signature params line
    const sigParamsMatch = signatureInput.match(/sig\d+=\([^)]+\)(.*)$/);
    const sigParams = sigParamsMatch ? `(${componentsMatch[1]})${sigParamsMatch[1]}` : signatureInput;
    signatureBaseLines.push(`"@signature-params": ${sigParams}`);

    const signatureBase = signatureBaseLines.join('\n');

    // 4. Parse the signature value (base64 encoded)
    // Format: sig1=:base64signature:
    const sigValueMatch = signature.match(/sig\d+=:([A-Za-z0-9+/=]+):/);
    if (!sigValueMatch) {
      console.warn('[pawapay-callback] Cannot parse signature value');
      return { valid: false, reason: 'invalid_signature_format' };
    }

    const signatureBytes = Uint8Array.from(atob(sigValueMatch[1]), c => c.charCodeAt(0));

    // 5. Import the public key and verify
    // pawaPay supported algorithms per their docs:
    // - ecdsa-p256-sha256 (EC P-256, primary)
    // - ecdsa-p384-sha384 (EC P-384)
    // - rsa-pss-sha512 (RSA-PSS with SHA-512)
    // - rsa-v1_5-sha256 (RSASSA-PKCS1-v1.5 with SHA-256)
    const algorithm = (algMatch?.[1] || publicKey.algorithm || '').toLowerCase();
    let cryptoAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
    let verifyAlgorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams;

    if (algorithm.includes('ecdsa-p384') || algorithm.includes('p-384') || algorithm.includes('p384')) {
      cryptoAlgorithm = { name: 'ECDSA', namedCurve: 'P-384' };
      verifyAlgorithm = { name: 'ECDSA', hash: 'SHA-384' };
    } else if (algorithm.includes('ecdsa') || algorithm.includes('p256') || algorithm.includes('p-256')) {
      cryptoAlgorithm = { name: 'ECDSA', namedCurve: 'P-256' };
      verifyAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
    } else if (algorithm.includes('rsa-pss') || algorithm.includes('ps512')) {
      cryptoAlgorithm = { name: 'RSA-PSS', hash: 'SHA-512' };
      verifyAlgorithm = { name: 'RSA-PSS', saltLength: 64 };
    } else if (algorithm.includes('rsa-v1_5') || algorithm.includes('rs256') || algorithm.includes('pkcs1')) {
      cryptoAlgorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      verifyAlgorithm = { name: 'RSASSA-PKCS1-v1_5' };
    } else if (algorithm.includes('ed25519')) {
      console.warn('[pawapay-callback] Ed25519 not supported in Web Crypto API');
      return { valid: false, reason: 'unsupported_algorithm' };
    } else {
      // Default to ECDSA P-256 (pawaPay's primary algorithm)
      cryptoAlgorithm = { name: 'ECDSA', namedCurve: 'P-256' };
      verifyAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
    }

    // Decode PEM public key
    const pemBody = publicKey.publicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      cryptoAlgorithm,
      false,
      ['verify']
    );

    // 6. Verify the signature
    const encoder = new TextEncoder();
    const dataToVerify = encoder.encode(signatureBase);

    const isValid = await crypto.subtle.verify(
      verifyAlgorithm,
      cryptoKey,
      signatureBytes,
      dataToVerify
    );

    if (isValid) {
      console.log('[pawapay-callback] Cryptographic signature verification PASSED');
      return { valid: true, reason: 'crypto_verified' };
    } else {
      console.warn('[pawapay-callback] Cryptographic signature verification FAILED');
      return { valid: false, reason: 'crypto_verification_failed' };
    }
  } catch (cryptoError: any) {
    console.error('[pawapay-callback] Crypto verification error:', cryptoError.message);
    // Don't trust the signature if crypto fails - don't leak internal error details
    return { valid: false, reason: 'crypto_error' };
  }
}

// ==================== Helper Functions ====================

/**
 * Notify all admins via email about a payment event
 */
async function notifyAdminsPaymentEvent(
  supabase: any,
  orderId: string,
  status: 'succeeded' | 'failed',
  provider: string
): Promise<void> {
  try {
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminUserIds = (adminRoles || []).map((r: any) => r.user_id);
    if (adminUserIds.length === 0) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .in('user_id', adminUserIds);

    const adminEmails = (profiles || []).map((p: any) => p.email).filter((e: string | null) => e);
    if (adminEmails.length === 0) return;

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop USA <noreply@afrishop-usa.com>';
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    if (!RESEND_API_KEY) return;

    // Get order + customer info
    const { data: order } = await supabase.from('orders').select('user_id, total_usd, total_cdf, normalized_amount, normalized_currency').eq('id', orderId).maybeSingle();
    let customerName = 'Unknown', customerEmail = 'N/A';
    if (order?.user_id) {
      const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('user_id', order.user_id).maybeSingle();
      customerName = profile?.full_name || profile?.email || 'Unknown';
      customerEmail = profile?.email || 'N/A';
    }

    const isSuccess = status === 'succeeded';
    const statusLabel = isSuccess ? '✅ Payment Successful' : '❌ Payment Failed';
    const statusColor = isSuccess ? '#16a34a' : '#dc2626';
    const amountStr = order?.total_usd ? `$${order.total_usd.toFixed(2)}` : 'N/A';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: adminEmails,
        subject: `[AfriShop] ${statusLabel} — Order ${orderId.slice(0, 8)}${isSuccess ? '' : ' — URGENT'}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:${statusColor};">${statusLabel}</h2>
            <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
              <p style="margin:0 0 8px;"><strong>Order ID:</strong> ${orderId}</p>
              <p style="margin:0 0 8px;"><strong>Customer:</strong> ${customerName}</p>
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${customerEmail}</p>
              <p style="margin:0 0 8px;"><strong>Amount:</strong> ${amountStr}</p>
              <p style="margin:0;"><strong>Provider:</strong> ${provider}</p>
            </div>
            <p style="font-size:14px;color:#666;">${isSuccess ? 'A new payment has been received. Please log in to process the order.' : 'A payment has failed. Please log in to check and contact the customer.'}</p>
            <p><a href="${frontendUrl}/admin/orders" style="background:${statusColor};color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Open Admin Orders</a></p>
          </div>
        `,
      }),
    });
    console.log(`[pawapay-callback] Admin payment notification sent to ${adminEmails.length} admins (${status})`);
  } catch (err) {
    console.error('[pawapay-callback] Failed to send admin payment notification:', err);
  }
}

/**
 * Send payment confirmation email if not already sent (idempotent)
 */
async function sendPaymentConfirmationEmailIfNeeded(
  supabase: any,
  orderId: string,
  traceId: string
): Promise<void> {
  try {
    // Check if email already sent
    const { data: orderCheck } = await supabase
      .from('orders')
      .select('payment_confirmation_email_sent_at')
      .eq('id', orderId)
      .single();
    
    if (orderCheck?.payment_confirmation_email_sent_at) {
      console.log(`[${traceId}] [PAYMENT_EMAIL] Email already sent, skipping`, { orderId });
      return;
    }
    
    // Mark as sent first (optimistic lock)
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_confirmation_email_sent_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('payment_confirmation_email_sent_at', null); // Only update if still null
    
    if (updateError) {
      console.warn(`[${traceId}] [PAYMENT_EMAIL] Failed to mark email as sent`, { orderId, error: updateError.message });
      return;
    }
    
    // Send email via edge function
    console.log(`[${traceId}] [PAYMENT_EMAIL] Sending confirmation email`, { orderId });
    
    const { error: invokeError } = await supabase.functions.invoke('send-payment-confirmation', {
      body: { orderId },
    });
    
    if (invokeError) {
      console.error(`[${traceId}] [PAYMENT_EMAIL] Send failed`, { orderId, error: invokeError.message });
    } else {
      console.log(`[${traceId}] [PAYMENT_EMAIL] Sent successfully`, { orderId });
    }
    
  } catch (error: any) {
    console.error(`[${traceId}] [PAYMENT_EMAIL] Error`, { orderId, error: error.message });
  }
}

// ==================== Main Handler ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  const config = getSecurityConfig();
  const clientIp = getClientIp(req);
  
  console.log(`[${traceId}] pawapay-callback received`, {
    env: config.env,
    clientIp,
    verifySignatures: config.verifySignatures,
    allowUnsignedWithIpCheck: config.allowUnsignedWithIpCheck,
  });

  try {
    // Parse callback payload first (needed for signature verification)
    const rawBody = await req.text();
    let payload: any;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error(`[${traceId}] Failed to parse callback body`);
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }), {
        status: 200, // Return 200 to prevent retries
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== Security Verification ====================
    
    if (config.verifySignatures) {
      const signatureResult = await verifySignature(req, rawBody, config);
      
      if (signatureResult.valid) {
        console.log(`[${traceId}] Signature verification: PASSED`);
      } else if (signatureResult.reason === 'unsigned') {
        // Request has no signature - check IP allowlist fallback
        if (config.allowUnsignedWithIpCheck) {
          if (isAllowedIp(clientIp, config.env)) {
            console.log(`[${traceId}] Unsigned request from allowed IP:`, clientIp);
          } else {
            console.error(`[${traceId}] IP_REJECTED: Unsigned request from non-allowlisted IP`, {
              receivedIp: clientIp,
              reason: 'ip_not_allowlisted',
            });
            return new Response(JSON.stringify({ 
              status: 'rejected', 
              message: 'Unauthorized',
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          console.warn(`[${traceId}] REJECTED: Unsigned requests not allowed`);
          return new Response(JSON.stringify({ 
            status: 'rejected', 
            message: 'Signature required' 
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        // Signature verification failed
        console.warn(`[${traceId}] Signature verification FAILED:`, signatureResult.reason);
        return new Response(JSON.stringify({ 
          status: 'rejected', 
          message: 'Invalid signature' 
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Signature verification disabled - use IP check only
      if (config.allowUnsignedWithIpCheck && !isAllowedIp(clientIp, config.env)) {
        console.error(`[${traceId}] IP_REJECTED: Request from non-allowlisted IP`, {
          receivedIp: clientIp,
          reason: 'ip_not_allowlisted',
        });
        return new Response(JSON.stringify({ 
          status: 'rejected', 
          message: 'Unauthorized',
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[${traceId}] Signature verification disabled, proceeding`);
    }

    // ==================== Validate Callback Payload with Zod ====================
    
    const parseResult = pawaPayCallbackSchema.safeParse(payload);
    
    if (!parseResult.success) {
      // Type guard ensures parseResult is SafeParseError here
      const errorResult = parseResult as { success: false; error: z.ZodError };
      const errors = errorResult.error.errors.map((e: z.ZodIssue) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      console.error(`[${traceId}] Payload validation failed:`, errors);
      
      // Return 200 to prevent retries but log the validation error
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: 'Invalid payload structure',
        validation_errors: errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const validatedPayload = parseResult.data;

    // ===== Multi-App Routing =====
    const callbackMetadata = validatedPayload.metadata || [];
    const appField = callbackMetadata.find((m: any) => m.fieldName === 'app');
    const appValue = appField?.fieldValue || 'afrishop'; // backward compat

    if (appValue === 'maishamarket') {
      console.log(`[${traceId}] Forwarding callback to MaishaMarket`, {
        depositId: validatedPayload.depositId,
        payoutId: validatedPayload.payoutId,
        status: validatedPayload.status,
      });
      try {
        const forwardRes = await fetch(
          'https://xuoihucaummfcbgazrja.supabase.co/functions/v1/pawapay-callback',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        const forwardData = await forwardRes.json();
        return new Response(JSON.stringify({ forwarded: true, ...forwardData }), {
          status: forwardRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (forwardErr: any) {
        console.error(`[${traceId}] MaishaMarket forward failed:`, forwardErr.message);
        return new Response(JSON.stringify({ forwarded: false, error: 'forward_failed' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }


    // ==================== Check if this is a PAYOUT callback ====================
    // PawaPay sends payout callbacks with payoutId instead of depositId
    if (validatedPayload.payoutId || (validatedPayload.metadata?.some?.((m: any) => m.fieldName === 'type' && m.fieldValue === 'referral_payout'))) {
      const supabaseForPayout = createAdminClient();
      const payoutId = validatedPayload.payoutId || validatedPayload.depositId;
      const payoutStatus = validatedPayload.status;

      console.log(`[${traceId}] [PAYOUT_CALLBACK] Referral payout callback:`, { payoutId, payoutStatus });

      if (payoutStatus === 'COMPLETED') {
        // Mark payout as completed
        const { data: payout } = await supabaseForPayout
          .from('referral_payouts')
          .select('id, commission_ids')
          .eq('pawapay_payout_id', payoutId)
          .maybeSingle();

        if (payout) {
          await supabaseForPayout
            .from('referral_payouts')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', payout.id);

          // Mark commissions as paid
          if (payout.commission_ids?.length) {
            await supabaseForPayout
              .from('referral_commissions')
              .update({ status: 'paid', paid_at: new Date().toISOString() })
              .in('id', payout.commission_ids);
          }
          console.log(`[${traceId}] [PAYOUT_CALLBACK] Payout completed:`, { payoutId });
        }
      } else if (payoutStatus === 'FAILED') {
        const failReason = validatedPayload.failureReason?.failureMessage || 'Payout failed';
        const { data: payout } = await supabaseForPayout
          .from('referral_payouts')
          .select('id, commission_ids')
          .eq('pawapay_payout_id', payoutId)
          .maybeSingle();

        if (payout) {
          await supabaseForPayout
            .from('referral_payouts')
            .update({ status: 'failed', failure_reason: failReason })
            .eq('id', payout.id);

          // Revert commissions to pending
          if (payout.commission_ids?.length) {
            await supabaseForPayout
              .from('referral_commissions')
              .update({ status: 'pending' })
              .in('id', payout.commission_ids);
          }
          console.log(`[${traceId}] [PAYOUT_CALLBACK] Payout failed:`, { payoutId, failReason });
        }
      }

      return new Response(JSON.stringify({ status: 'ok', type: 'payout_callback' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // (Multi-App routing already handled above — only afrishop reaches here)

    // ==================== Process Deposit Callback ====================
    
    // Initialize admin client
    const supabase = createAdminClient();

    // Extract validated fields
    const depositId = validatedPayload.depositId;
    const status = validatedPayload.status;
    const amount = validatedPayload.amount;
    const currency = validatedPayload.currency;
    const failureReason = validatedPayload.failureReason;
    const correspondentIds = validatedPayload.correspondentIds;

    console.log(`[${traceId}] [PAWAPAY_CALLBACK_HIT]`, {
      depositId,
      status,
      amount,
      currency,
      clientIp,
      validated: true,
    });

    // Check for duplicate callback (idempotency)
    const eventResult = await logPaymentEvent(supabase, {
      provider_key: 'pawapay',
      event_type: 'callback_received',
      event_id: `${depositId}_${status}`,
      payload,
    });

    if (eventResult.duplicate) {
      console.log(`[${traceId}] Duplicate callback ignored for depositId:`, depositId);
      return new Response(JSON.stringify({ status: 'ok', idempotent: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find payment record by deposit ID
    const payment = await getPaymentByDepositId(supabase, 'pawapay', depositId);

    if (!payment) {
      console.error(`[${traceId}] Payment not found for depositId:`, depositId);
      // Still return 200 to prevent pawaPay from retrying
      return new Response(JSON.stringify({ status: 'warning', message: 'Payment not found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${traceId}] Found payment:`, {
      paymentId: payment.id,
      orderId: payment.order_id,
      currentStatus: payment.status,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus('pawapay', status);
    console.log(`[${traceId}] Status:`, { raw: status, normalized: normalizedStatus });

    // Update payment record
    const now = new Date().toISOString();
    const rawEvents = [...(payment.raw_events || []), payload];

    await updatePaymentStatus(supabase, payment.id, normalizedStatus, {
      provider_transaction_id: correspondentIds?.operatorId || depositId,
      paid_at: normalizedStatus === 'succeeded' ? now : undefined,
      raw_events: rawEvents,
    });

    // Update order status
    if (normalizedStatus === 'succeeded') {
      const paymentKind = (payment as any).kind || 'full';

      if (paymentKind === 'balance') {
        // BALANCE payment: order is already PAID — only flip balance_status and record the link.
        console.log(`[${traceId}] [PAYMENT_VERIFY] BALANCE payment SUCCESS - marking balance paid`);
        await supabase.from('orders').update({
          balance_status: 'paid',
          balance_paid_at: now,
          balance_payment_provider: 'pawapay',
          balance_payment_reference: payment.reference,
          updated_at: now,
        }).eq('id', payment.order_id);
      } else {
        // FULL or DEPOSIT payment: existing flow — order becomes PAID and downstream emails/shipping fire.
        console.log(`[${traceId}] [PAYMENT_VERIFY] Payment SUCCESS (kind=${paymentKind}) - updating order to PAID`);
        const { data: rpcResult, error: rpcError } = await supabase.rpc('finalize_paid_order', {
          p_order_id: payment.order_id,
          p_payment_ref: depositId,
          p_operator_ref: correspondentIds?.operatorId || null,
          p_trace_id: traceId,
        });

        if (rpcError) {
          console.error(`[${traceId}] finalize_paid_order RPC error:`, rpcError);
          await supabase.from('orders').update({
            status: 'PAID',
            operator_ref_id: correspondentIds?.operatorId || null,
            payment_verified_at: now,
            updated_at: now,
          }).eq('id', payment.order_id);
        } else {
          console.log(`[${traceId}] Order finalized:`, rpcResult);
        }
      }


      // Send confirmation email (idempotent)
      await sendPaymentConfirmationEmailIfNeeded(supabase, payment.order_id, traceId);

      // Notify all admins about successful payment (fire-and-forget)
      notifyAdminsPaymentEvent(supabase, payment.order_id, 'succeeded', 'PawaPay (Mobile Money)').catch(() => {});

      // Referral commission (fire-and-forget)
      const { data: paidOrder } = await supabase.from('orders').select('user_id, total_amount').eq('id', payment.order_id).maybeSingle();
      if (paidOrder?.user_id) {
        createReferralCommission(supabase, payment.order_id, paidOrder.user_id, paidOrder.total_amount || 0, 'pawapay-callback').catch(() => {});
      }

    } else if (normalizedStatus === 'failed') {
      console.log(`[${traceId}] [PAYMENT_VERIFY] Payment FAILED - order stays PENDING_PAYMENT`);

      await supabase.from('orders').update({
        payment_notes: failureReason?.failureMessage || 'Payment failed',
        updated_at: now,
      }).eq('id', payment.order_id);

      // Notify all admins about failed payment (fire-and-forget)
      notifyAdminsPaymentEvent(supabase, payment.order_id, 'failed', 'PawaPay (Mobile Money)').catch(() => {});
    }

    // Log to audit
    await logAudit(supabase, {
      traceId,
      eventType: 'PAWAPAY_CALLBACK_PROCESSED',
      orderId: payment.order_id,
      payload: {
        depositId,
        status,
        normalizedStatus,
        amount,
        currency,
        clientIp,
        signatureVerified: config.verifySignatures,
      },
    });

    console.log(`[${traceId}] Callback processed successfully`);

    return new Response(JSON.stringify({
      status: 'ok',
      success: true,
      orderId: payment.order_id,
      paymentStatus: normalizedStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(`[${traceId}] Callback error:`, error.message);

    // Return 200 even on error to prevent infinite retries
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Internal error processing callback',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
