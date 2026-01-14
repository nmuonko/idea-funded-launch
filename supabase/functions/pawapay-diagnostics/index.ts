/**
 * pawapay-diagnostics Edge Function
 * 
 * SAFE diagnostic endpoint that validates phone format and shows what payload
 * WOULD be sent to pawaPay, WITHOUT actually calling the pawaPay API.
 * 
 * This is for pre-flight validation before building AAB releases.
 * 
 * GET:  Returns { ok, tokenPresent, baseUrl, timestamp }
 * POST: { order_id?, phone } -> validates phone, returns { normalizedPhone, payloadPreview, ... }
 * 
 * Security: verify_jwt=false, does NOT leak secrets
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== Phone Normalization (same as pawapayAdapter) ====================

/**
 * Normalize phone number to digits only (removes +, spaces, hyphens)
 */
function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  return rawPhone.trim().replace(/[\s\-\+\(\)]/g, '');
}

/**
 * Validate phone number for DRC (must start with 243, length 12)
 */
function validateDRCPhone(phone: string): { valid: boolean; reason?: string } {
  const digits = normalizePhone(phone);
  
  if (digits.length === 0) {
    return { valid: false, reason: 'Phone number is required' };
  }
  
  // After normalization, should be 12 digits (243 + 9 digits)
  // Or 9 digits if no country code
  if (digits.length < 9) {
    return { valid: false, reason: `Phone too short (${digits.length} digits, need 9-12)` };
  }
  
  if (digits.length > 15) {
    return { valid: false, reason: `Phone too long (${digits.length} digits, max 15)` };
  }
  
  // Check if starts with 243 (DRC country code)
  if (digits.startsWith('243')) {
    if (digits.length !== 12) {
      return { valid: false, reason: `DRC phone with 243 prefix should be 12 digits, got ${digits.length}` };
    }
    return { valid: true };
  }
  
  // Check if starts with 0 (local format)
  if (digits.startsWith('0')) {
    if (digits.length !== 10) {
      return { valid: false, reason: `Local phone with 0 prefix should be 10 digits, got ${digits.length}` };
    }
    return { valid: true };
  }
  
  // Assume it's missing country code (9 digits)
  if (digits.length === 9) {
    return { valid: true };
  }
  
  return { valid: false, reason: `Unrecognized phone format (${digits.length} digits)` };
}

/**
 * Format phone to E.164 for DRC
 */
function formatPhoneE164(phoneNumber: string): string {
  const cleaned = normalizePhone(phoneNumber);
  
  if (cleaned.startsWith('243')) {
    return cleaned;
  }
  if (cleaned.startsWith('0')) {
    return '243' + cleaned.slice(1);
  }
  return '243' + cleaned;
}

/**
 * Mask phone for logging (show only last 4 digits)
 */
function maskPhone(phone: string): string {
  const e164 = formatPhoneE164(phone);
  if (e164.length <= 4) return '****';
  return '*'.repeat(e164.length - 4) + e164.slice(-4);
}

// ==================== DRC Mobile Money Correspondents ====================

const DRC_CORRESPONDENTS: Record<string, string> = {
  '81': 'VODACOM_MPESA_COD', '82': 'VODACOM_MPESA_COD', '83': 'VODACOM_MPESA_COD',
  '99': 'AIRTEL_COD', '97': 'AIRTEL_COD',
  '84': 'ORANGE_COD', '85': 'ORANGE_COD', '89': 'ORANGE_COD',
};

function detectCorrespondent(phoneNumber: string): string {
  const cleaned = normalizePhone(phoneNumber);
  let prefix = '';
  if (cleaned.startsWith('243')) {
    prefix = cleaned.slice(3, 5);
  } else if (cleaned.startsWith('0')) {
    prefix = cleaned.slice(1, 3);
  } else {
    prefix = cleaned.slice(0, 2);
  }
  return DRC_CORRESPONDENTS[prefix] || 'VODACOM_MPESA_COD';
}

// ==================== Config Check ====================

function detectEnvFromUrl(baseUrl: string): 'sandbox' | 'production' {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname.includes('sandbox') ? 'sandbox' : 'production';
  } catch {
    return 'sandbox';
  }
}

interface DiagnosticsResponse {
  ok: boolean;
  tokenPresent: boolean;
  baseUrl?: 'sandbox' | 'production';
  baseUrlDomain?: string;
  timestamp: string;
  // For POST with phone
  normalizedPhone?: string;
  maskedPhone?: string;
  phoneValidation?: { valid: boolean; reason?: string };
  correspondent?: string;
  payloadPreview?: Record<string, unknown>;
  selectedCurrency?: 'USD' | 'CDF';
  amount?: number;
  // Error
  error?: string;
  error_code?: string;
}

// ==================== Main Handler ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const timestamp = new Date().toISOString();
  console.log('[PAWAPAY_DIAGNOSTICS] Request:', req.method);

  try {
    // Check environment variables (never log the actual token)
    const apiToken = (Deno.env.get('PAWAPAY_API_TOKEN') || '').trim();
    const baseUrl = (Deno.env.get('PAWAPAY_BASE_URL') || '').trim();
    
    const tokenPresent = apiToken.length > 0;
    let baseUrlMode: 'sandbox' | 'production' = 'sandbox';
    let baseUrlDomain = 'N/A';
    
    if (baseUrl.length > 0) {
      try {
        baseUrlDomain = new URL(baseUrl).hostname;
        baseUrlMode = detectEnvFromUrl(baseUrl);
      } catch {
        baseUrlDomain = 'INVALID_URL';
      }
    }

    // ==================== GET: Config check only ====================
    if (req.method === 'GET') {
      const response: DiagnosticsResponse = {
        ok: tokenPresent && baseUrl.length > 0,
        tokenPresent,
        baseUrl: baseUrl.length > 0 ? baseUrlMode : undefined,
        baseUrlDomain: baseUrl.length > 0 ? baseUrlDomain : undefined,
        timestamp,
      };
      
      if (!tokenPresent || baseUrl.length === 0) {
        response.error = 'pawaPay not configured';
        response.error_code = 'PAWAPAY_NOT_CONFIGURED';
      }
      
      console.log('[PAWAPAY_DIAGNOSTICS] GET result:', {
        ok: response.ok,
        tokenPresent,
        baseUrl: baseUrlMode,
      });
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== POST: Validate phone + preview payload ====================
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: { order_id?: string; phone?: string; currency?: string; amount?: number } = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { order_id, phone, currency: reqCurrency, amount: reqAmount } = body;

    // Phone is required for POST
    if (!phone) {
      return new Response(JSON.stringify({
        ok: false,
        tokenPresent,
        baseUrl: baseUrlMode,
        timestamp,
        error: 'phone is required',
        error_code: 'PHONE_REQUIRED',
      } satisfies DiagnosticsResponse), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate phone
    const phoneValidation = validateDRCPhone(phone);
    const normalizedPhone = formatPhoneE164(phone);
    const maskedPhone = maskPhone(phone);
    const correspondent = detectCorrespondent(phone);

    // Optionally fetch order details
    let amount = reqAmount || 100; // Default for preview
    let selectedCurrency: 'USD' | 'CDF' = reqCurrency?.toUpperCase() === 'CDF' ? 'CDF' : 'USD';

    if (order_id) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('total_usd, total_cdf, exchange_rate_used')
        .eq('id', order_id)
        .single();
      
      if (order && !orderError) {
        amount = selectedCurrency === 'CDF' 
          ? (order.total_cdf || Math.round((order.total_usd || 0) * (order.exchange_rate_used || 2800)))
          : (order.total_usd || 0);
      }
    }

    // Build preview payload (what WOULD be sent to pawaPay)
    const depositId = `diag-${crypto.randomUUID().slice(0, 12)}`;
    const payloadPreview = {
      depositId,
      amount: amount.toFixed(2),
      currency: selectedCurrency,
      correspondent,
      payer: {
        type: 'MSISDN',
        address: {
          value: normalizedPhone,
        },
      },
      customerTimestamp: timestamp,
      statementDescription: order_id 
        ? `AFRISHOP-${order_id.replace(/[^A-Za-z0-9]/g, '').slice(-12)}`
        : 'AFRISHOP-DIAG',
    };

    const response: DiagnosticsResponse = {
      ok: phoneValidation.valid && tokenPresent && baseUrl.length > 0,
      tokenPresent,
      baseUrl: baseUrlMode,
      baseUrlDomain,
      timestamp,
      normalizedPhone,
      maskedPhone,
      phoneValidation,
      correspondent,
      payloadPreview,
      selectedCurrency,
      amount,
    };

    if (!phoneValidation.valid) {
      response.error = phoneValidation.reason;
      response.error_code = 'INVALID_PHONE';
    } else if (!tokenPresent || baseUrl.length === 0) {
      response.error = 'pawaPay not configured';
      response.error_code = 'PAWAPAY_NOT_CONFIGURED';
    }

    console.log('[PAWAPAY_DIAGNOSTICS] POST result:', {
      ok: response.ok,
      phoneValid: phoneValidation.valid,
      maskedPhone,
      correspondent,
      selectedCurrency,
      amount,
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[PAWAPAY_DIAGNOSTICS] Error:', error.message);
    return new Response(JSON.stringify({
      ok: false,
      tokenPresent: false,
      timestamp,
      error: error.message,
      error_code: 'INTERNAL_ERROR',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
