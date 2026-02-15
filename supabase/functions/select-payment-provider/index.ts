/**
 * select-payment-provider Edge Function
 * 
 * CRITICAL: This is the ONLY endpoint that can trigger provider API calls (pawaPay/Stripe).
 * mobile-checkout creates a checkout_session with status='awaiting_provider_selection'.
 * This function is called after user explicitly selects a payment method.
 * 
 * Payment Flow:
 * 1. User taps "Pay Now" → mobile-checkout creates checkout_session (no provider call)
 * 2. User selects payment method → this function is called
 * 3. This function validates, creates payment_attempt, calls provider API
 * 
 * Idempotency: Uses partial unique index on payment_attempts (order_id, provider)
 * for active statuses to prevent duplicate charges.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";
import { 
  getActiveProvider, 
  createPaymentRecord,
  generatePaymentReference,
  validateProviderSecrets,
} from "../_shared/paymentProviders.ts";
import { createDeposit, getPawaPayConfig, ConfigMissingError } from "../_shared/pawapayAdapter.ts";
import { round2 } from "../_shared/settings-cache.ts";
import { sanitizePaymentError } from "../_shared/errorSanitizer.ts";

// Valid provider selections
type ProviderSelection = 'pawapay' | 'stripe' | 'bank_transfer';
const VALID_PROVIDERS: ProviderSelection[] = ['pawapay', 'stripe', 'bank_transfer'];

// Payment statuses for state machine
type PaymentAttemptStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'expired' | 'cancelled';

serve(async (req) => {
  console.log('[PAYMENT_FLOW] select-payment-provider invoked');
  
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    // ============================================
    // STEP 1: Authenticate user
    // ============================================
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[PAYMENT_FLOW] User authenticated:', user.id.slice(0, 8) + '***');

    const body = await req.json();
    const { checkout_session_id, provider, phone, operator } = body;

    // ============================================
    // STEP 2: Validate required fields
    // ============================================
    if (!checkout_session_id) {
      console.log('[PAYMENT_FLOW] VALIDATION_ERROR: missing checkout_session_id');
      return jsonResponse({
        ok: false,
        success: false,
        code: 'MISSING_CHECKOUT_SESSION',
        message: 'Checkout session ID is required.',
        message_fr: 'L\'identifiant de session de paiement est requis.',
      }, 200);
    }

    if (!provider || !VALID_PROVIDERS.includes(provider as ProviderSelection)) {
      console.log('[PAYMENT_FLOW] VALIDATION_ERROR: invalid provider', { provider, valid: VALID_PROVIDERS });
      return jsonResponse({
        ok: false,
        success: false,
        code: 'INVALID_PROVIDER',
        message: 'Invalid payment provider. Choose: pawapay, stripe, or bank_transfer.',
        message_fr: 'Fournisseur de paiement invalide. Choisissez: pawapay, stripe, ou bank_transfer.',
        valid_providers: VALID_PROVIDERS,
      }, 200);
    }

    // pawaPay requires phone number
    if (provider === 'pawapay' && !phone) {
      console.log('[PAYMENT_FLOW] VALIDATION_ERROR: pawapay requires phone');
      return jsonResponse({
        ok: false,
        success: false,
        code: 'PHONE_REQUIRED',
        message: 'Phone number is required for mobile money payments.',
        message_fr: 'Le numéro de téléphone est requis pour les paiements mobile money.',
      }, 200);
    }

    // ============================================
    // STEP 3: Fetch and validate checkout session
    // ============================================
    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', checkout_session_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (sessionError || !session) {
      console.log('[PAYMENT_FLOW] SESSION_NOT_FOUND', { checkout_session_id, error: sessionError?.message });
      return jsonResponse({
        ok: false,
        success: false,
        code: 'SESSION_NOT_FOUND',
        message: 'Checkout session not found or expired.',
        message_fr: 'Session de paiement introuvable ou expirée.',
      }, 200);
    }

    // Validate session status allows provider selection
    const allowedStatuses = ['awaiting_provider_selection', 'choice_required', 'initiated', 'pending'];
    if (!allowedStatuses.includes(session.status)) {
      console.log('[PAYMENT_FLOW] SESSION_STATUS_INVALID', { 
        checkout_session_id, 
        status: session.status,
        allowed: allowedStatuses 
      });

      // If already paid, return success with existing info
      if (session.status === 'paid' || session.status === 'completed') {
        return jsonResponse({
          success: true,
          idempotent: true,
          code: 'ALREADY_PAID',
          message: 'This order has already been paid.',
          message_fr: 'Cette commande a déjà été payée.',
          order_id: session.order_id,
          checkout_session_id: session.id,
        });
      }

      return jsonResponse({
        ok: false,
        success: false,
        code: 'INVALID_SESSION_STATUS',
        message: 'Session is not in a valid state for provider selection.',
        message_fr: 'La session n\'est pas dans un état valide pour la sélection du fournisseur.',
        current_status: session.status,
      }, 200);
    }

    // Check session expiry (30 minutes)
    const sessionAge = (Date.now() - new Date(session.created_at).getTime()) / (1000 * 60);
    if (sessionAge > 30) {
      console.log('[PAYMENT_FLOW] SESSION_EXPIRED', { checkout_session_id, age_minutes: sessionAge });
      
      await supabase
        .from('checkout_sessions')
        .update({ status: 'expired' })
        .eq('id', checkout_session_id);

      return jsonResponse({
        ok: false,
        success: false,
        code: 'SESSION_EXPIRED',
        message: 'Checkout session has expired. Please start a new checkout.',
        message_fr: 'La session de paiement a expiré. Veuillez recommencer le paiement.',
      }, 200);
    }

    // ============================================
    // STEP 4: Extract server-calculated amounts (NEVER trust client)
    // ============================================
    const orderId = session.order_id;
    const amount = Number(session.grand_total);
    const currency = session.currency as 'USD' | 'CDF';

    console.log('[PAYMENT_FLOW] PROVIDER_SELECTION', {
      checkout_session_id,
      order_id: orderId,
      user_id: user.id.slice(0, 8) + '***',
      provider,
      amount,
      currency,
      endpoint: 'select-payment-provider',
    });

    // ============================================
    // STEP 5: Check idempotency - reuse existing payment_attempt
    // ============================================
    const { data: existingAttempt, error: attemptError } = await supabase
      .from('payment_attempts')
      .select('*')
      .eq('order_id', orderId)
      .eq('provider', provider)
      .in('status', ['pending', 'processing', 'paid'])
      .maybeSingle();

    if (attemptError) {
      console.warn('[PAYMENT_FLOW] IDEMPOTENCY_CHECK_ERROR', attemptError.message);
    }

    if (existingAttempt) {
      console.log('[PAYMENT_FLOW] IDEMPOTENCY_HIT', {
        order_id: orderId,
        provider,
        existing_attempt_id: existingAttempt.id,
        existing_provider_ref: existingAttempt.provider_ref,
        status: existingAttempt.status,
      });

      // If already paid, return success
      if (existingAttempt.status === 'paid') {
        return jsonResponse({
          success: true,
          idempotent: true,
          code: 'ALREADY_PAID',
          message: 'This order has already been paid.',
          message_fr: 'Cette commande a déjà été payée.',
          order_id: orderId,
          checkout_session_id,
          payment_attempt_id: existingAttempt.id,
        });
      }

      // Return existing pending attempt for pawaPay
      if (provider === 'pawapay' && existingAttempt.provider_ref) {
        const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://afri-shop.com';
        const redirectUrl = `${frontendUrl}/payment-callback?orderId=${encodeURIComponent(orderId)}&provider=pawapay&depositId=${encodeURIComponent(existingAttempt.provider_ref)}`;

        return jsonResponse({
          success: true,
          idempotent: true,
          provider: 'pawapay',
          payment_attempt_id: existingAttempt.id,
          deposit_id: existingAttempt.provider_ref,
          order_id: orderId,
          checkout_session_id,
          status: 'pending_user_confirmation',
          redirectUrl,
          message: 'Payment request already sent. Please check your phone.',
          message_fr: 'Demande de paiement déjà envoyée. Vérifiez votre téléphone.',
        });
      }

      // Return existing Stripe attempt
      if (provider === 'stripe' && existingAttempt.provider_ref) {
        // Fetch the payment record for client_secret
        const { data: paymentRecord } = await supabase
          .from('payments')
          .select('client_secret')
          .eq('provider_deposit_id', existingAttempt.provider_ref)
          .maybeSingle();

        if (paymentRecord?.client_secret) {
          return jsonResponse({
            success: true,
            idempotent: true,
            provider: 'stripe',
            payment_attempt_id: existingAttempt.id,
            order_id: orderId,
            checkout_session_id,
            clientSecret: paymentRecord.client_secret,
            status: 'initiated',
            message: 'Card payment already initiated.',
            message_fr: 'Paiement par carte déjà initié.',
          });
        }
      }
    }

    // ============================================
    // STEP 6: Update session with selected provider
    // ============================================
    const { error: updateSessionError } = await supabase
      .from('checkout_sessions')
      .update({
        selected_provider: provider,
        status: 'provider_selected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', checkout_session_id);

    if (updateSessionError) {
      console.error('[PAYMENT_FLOW] SESSION_UPDATE_ERROR', updateSessionError.message);
    }

    // ============================================
    // STEP 7: Create payment_attempt record
    // ============================================
    const reference = generatePaymentReference(orderId);
    
    // Generate cart hash from session metadata
    const cartHash = session.integrity_hash || 'session-based';

    const { data: paymentAttempt, error: createAttemptError } = await supabase
      .from('payment_attempts')
      .insert({
        order_id: orderId,
        checkout_session_id,
        user_id: user.id,
        provider,
        amount,
        currency,
        cart_hash: cartHash,
        idempotency_key: `${orderId}-${provider}-${Date.now()}`,
        status: 'pending',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
      })
      .select('id')
      .single();

    if (createAttemptError) {
      // Check if it's a unique constraint violation (idempotency hit)
      if (createAttemptError.message.includes('unique') || createAttemptError.message.includes('duplicate')) {
        console.log('[PAYMENT_FLOW] IDEMPOTENCY_CONSTRAINT_HIT', { order_id: orderId, provider });
        // Re-fetch the existing attempt
        const { data: refetchedAttempt } = await supabase
          .from('payment_attempts')
          .select('*')
          .eq('order_id', orderId)
          .eq('provider', provider)
          .in('status', ['pending', 'processing', 'paid'])
          .maybeSingle();

        if (refetchedAttempt) {
          return jsonResponse({
            success: true,
            idempotent: true,
            message: 'Payment attempt already exists.',
            payment_attempt_id: refetchedAttempt.id,
            order_id: orderId,
            checkout_session_id,
          });
        }
      }

      console.error('[PAYMENT_FLOW] CREATE_ATTEMPT_ERROR', createAttemptError.message);
      return jsonResponse({
        ok: false,
        success: false,
        code: 'PAYMENT_ATTEMPT_FAILED',
        message: 'Unable to process payment. Please try again.',
        message_fr: 'Impossible de traiter le paiement. Veuillez réessayer.',
      }, 200);
    }

    console.log('[PAYMENT_FLOW] PAYMENT_ATTEMPT_CREATED', {
      payment_attempt_id: paymentAttempt?.id,
      order_id: orderId,
      provider,
      amount,
      currency,
    });

    // ============================================
    // STEP 8: Call provider API based on selection
    // ============================================
    
    // -------------------- PAWAPAY --------------------
    if (provider === 'pawapay') {
      console.log('[PAYMENT_FLOW] PROVIDER_API_CALL', {
        order_id: orderId,
        user_id: user.id.slice(0, 8) + '***',
        checkout_session_id,
        provider: 'pawapay',
        amount,
        currency,
        endpoint: 'select-payment-provider',
        action: 'createDeposit',
      });

      // Fetch profile for country code
      const { data: profile } = await supabase
        .from('profiles')
        .select('country')
        .eq('user_id', user.id)
        .maybeSingle();

      // Determine country/correspondent
      const country = profile?.country?.toUpperCase().includes('CONGO') ? 'COD' : 'COD';

      // Get provider config
      const pawaProvider = await getActiveProvider(supabase, country, 'MOBILE_MONEY');
      
      if (!pawaProvider || pawaProvider.provider_key !== 'pawapay' || !pawaProvider.is_enabled) {
        console.error('[PAYMENT_FLOW] PAWAPAY_NOT_AVAILABLE');
        return jsonResponse({
          ok: false,
          success: false,
          code: 'PROVIDER_NOT_AVAILABLE',
          message: 'Mobile money payments are temporarily unavailable.',
          message_fr: 'Les paiements mobile money sont temporairement indisponibles.',
        }, 200);
      }

      const secretsValid = validateProviderSecrets(pawaProvider);
      if (!secretsValid.valid) {
        console.error('[PAYMENT_FLOW] PAWAPAY_SECRETS_MISSING', { missing: secretsValid.missing });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'PROVIDER_CONFIG_ERROR',
          message: 'Mobile money payments are temporarily unavailable.',
          message_fr: 'Les paiements mobile money sont temporairement indisponibles.',
        }, 200);
      }

      try {
        const pawaConfig = getPawaPayConfig(pawaProvider);
        
        const depositResult = await createDeposit(pawaConfig, {
          orderId,
          amount,
          currency,
          customerPhone: phone,
          customerEmail: user.email || '',
          country,
          reference,
          description: `AfriShop Order #${orderId.slice(0, 8)}`,
          operator, // Pass operator override from frontend
        });

        if (depositResult.success) {
          // Update payment_attempt with provider reference
          await supabase
            .from('payment_attempts')
            .update({
              provider_ref: depositResult.provider_deposit_id,
              status: 'pending',
            })
            .eq('id', paymentAttempt!.id);

          // Create payment record
          await createPaymentRecord(supabase, {
            order_id: orderId,
            provider_key: 'pawapay',
            amount,
            currency,
            reference,
            customer_phone: phone,
            country,
            provider_deposit_id: depositResult.provider_deposit_id,
            raw_request: depositResult.raw_request,
            status: 'pending',
          });

          // Update checkout session
          await supabase
            .from('checkout_sessions')
            .update({
              status: 'initiated',
              provider_triggered_at: new Date().toISOString(),
            })
            .eq('id', checkout_session_id);

          // Update order status
          await supabase
            .from('orders')
            .update({
              status: 'PENDING_PAYMENT',
              maisha_payment_status: 'PENDING',
            })
            .eq('id', orderId);

          console.log('[PAYMENT_FLOW] PAWAPAY_DEPOSIT_SUCCESS', {
            order_id: orderId,
            deposit_id: depositResult.provider_deposit_id,
            payment_attempt_id: paymentAttempt!.id,
          });

          const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://afri-shop.com';
          const redirectUrl = `${frontendUrl}/payment-callback?orderId=${encodeURIComponent(orderId)}&provider=pawapay&depositId=${encodeURIComponent(depositResult.provider_deposit_id || '')}`;

          return jsonResponse({
            success: true,
            provider: 'pawapay',
            payment_attempt_id: paymentAttempt!.id,
            deposit_id: depositResult.provider_deposit_id,
            depositId: depositResult.provider_deposit_id, // Legacy field
            order_id: orderId,
            checkout_session_id,
            status: 'pending_user_confirmation',
            redirectUrl,
            message: 'Payment request sent to your phone. Please confirm.',
            message_fr: 'Demande de paiement envoyée à votre téléphone. Veuillez confirmer.',
            amount,
            currency,
          });
        } else {
          // pawaPay rejected
          await supabase
            .from('payment_attempts')
            .update({ status: 'failed', last_error: sanitizePaymentError(depositResult.error) })
            .eq('id', paymentAttempt!.id);

          console.error('[PAYMENT_FLOW] PAWAPAY_DEPOSIT_FAILED', {
            order_id: orderId,
            error: depositResult.error,
            errorDetails: depositResult.errorDetails,
          });

          return jsonResponse({
            ok: false,
            success: false,
            code: 'PAWAPAY_FAILED',
            message: 'Mobile money payment failed. Please try again.',
            message_fr: 'Le paiement mobile money a échoué. Veuillez réessayer.',
            order_id: orderId,
          }, 200);
        }
      } catch (pawaError: any) {
        await supabase
          .from('payment_attempts')
          .update({ status: 'failed', last_error: sanitizePaymentError(pawaError.message) })
          .eq('id', paymentAttempt!.id);

        console.error('[PAYMENT_FLOW] PAWAPAY_EXCEPTION', {
          order_id: orderId,
          error: pawaError.message,
        });

        if (pawaError instanceof ConfigMissingError) {
          return jsonResponse({
            ok: false,
            success: false,
            code: 'PROVIDER_NOT_CONFIGURED',
            message: 'Mobile money payments are temporarily unavailable.',
            message_fr: 'Les paiements mobile money sont temporairement indisponibles.',
          }, 200);
        }

        return jsonResponse({
          ok: false,
          success: false,
          code: 'PAWAPAY_ERROR',
          message: 'An error occurred processing your payment.',
          message_fr: 'Une erreur s\'est produite lors du traitement de votre paiement.',
        }, 200);
      }
    }

    // -------------------- STRIPE --------------------
    if (provider === 'stripe') {
      console.log('[PAYMENT_FLOW] PROVIDER_API_CALL', {
        order_id: orderId,
        user_id: user.id.slice(0, 8) + '***',
        checkout_session_id,
        provider: 'stripe',
        amount,
        currency: 'USD', // Stripe always USD
        endpoint: 'select-payment-provider',
        action: 'createPaymentIntent',
      });

      // Enforce USD for Stripe
      if (currency !== 'USD') {
        console.log('[PAYMENT_FLOW] STRIPE_USD_REQUIRED', { requested: currency });
        return jsonResponse({
          ok: false,
          success: false,
          code: 'USD_REQUIRED',
          message: 'Card payments require USD currency.',
          message_fr: 'Les paiements par carte nécessitent la devise USD.',
        }, 200);
      }

      try {
        const stripeProvider = await getActiveProvider(supabase, 'COD', 'CARD');
        
        if (!stripeProvider || stripeProvider.provider_key !== 'stripe' || !stripeProvider.is_enabled) {
          console.error('[PAYMENT_FLOW] STRIPE_NOT_AVAILABLE');
          return jsonResponse({
            ok: false,
            success: false,
            code: 'CARD_NOT_AVAILABLE',
            message: 'Card payments are temporarily unavailable.',
            message_fr: 'Les paiements par carte sont temporairement indisponibles.',
          }, 200);
        }

        const { createPaymentIntent, getStripeConfig } = await import('../_shared/stripeAdapter.ts');
        const stripeConfig = getStripeConfig(stripeProvider);

        const stripeResult = await createPaymentIntent(stripeConfig, {
          orderId,
          userId: user.id,
          intentId: reference,
          amount,
          description: `AfriShop Order #${orderId.slice(0, 8)}`,
        });

        if (stripeResult.success && stripeResult.client_secret) {
          // Update payment_attempt
          await supabase
            .from('payment_attempts')
            .update({
              provider_ref: stripeResult.provider_deposit_id,
              status: 'pending',
            })
            .eq('id', paymentAttempt!.id);

          // Create payment record
          await createPaymentRecord(supabase, {
            order_id: orderId,
            provider_key: 'stripe',
            amount,
            currency: 'USD',
            reference,
            provider_deposit_id: stripeResult.provider_deposit_id,
            client_secret: stripeResult.client_secret,
            raw_request: stripeResult.raw_request,
            status: 'pending',
          });

          // Update checkout session
          await supabase
            .from('checkout_sessions')
            .update({
              status: 'initiated',
              provider_triggered_at: new Date().toISOString(),
            })
            .eq('id', checkout_session_id);

          // Update order status
          await supabase
            .from('orders')
            .update({
              status: 'PENDING_PAYMENT',
            })
            .eq('id', orderId);

          console.log('[PAYMENT_FLOW] STRIPE_INTENT_SUCCESS', {
            order_id: orderId,
            payment_intent_id: stripeResult.provider_deposit_id,
            payment_attempt_id: paymentAttempt!.id,
          });

          return jsonResponse({
            success: true,
            provider: 'stripe',
            payment_attempt_id: paymentAttempt!.id,
            order_id: orderId,
            checkout_session_id,
            clientSecret: stripeResult.client_secret,
            status: 'initiated',
            message: 'Card payment initialized. Complete payment in app.',
            message_fr: 'Paiement par carte initialisé. Terminez le paiement dans l\'application.',
            amount,
            currency: 'USD',
          });
        } else {
          await supabase
            .from('payment_attempts')
            .update({ status: 'failed', last_error: sanitizePaymentError(stripeResult.error) })
            .eq('id', paymentAttempt!.id);

          console.error('[PAYMENT_FLOW] STRIPE_INTENT_FAILED', {
            order_id: orderId,
            error: stripeResult.error,
          });

          return jsonResponse({
            ok: false,
            success: false,
            code: 'STRIPE_FAILED',
            message: 'Failed to initialize card payment.',
            message_fr: 'Échec de l\'initialisation du paiement par carte.',
          }, 200);
        }
      } catch (stripeError: any) {
        await supabase
          .from('payment_attempts')
          .update({ status: 'failed', last_error: sanitizePaymentError(stripeError.message) })
          .eq('id', paymentAttempt!.id);

        console.error('[PAYMENT_FLOW] STRIPE_EXCEPTION', {
          order_id: orderId,
          error: stripeError.message,
        });

        return jsonResponse({
          ok: false,
          success: false,
          code: 'STRIPE_ERROR',
          message: 'An error occurred processing your card payment.',
          message_fr: 'Une erreur s\'est produite lors du traitement de votre paiement par carte.',
        }, 200);
      }
    }

    // -------------------- BANK_TRANSFER --------------------
    if (provider === 'bank_transfer') {
      console.log('[PAYMENT_FLOW] BANK_TRANSFER_SELECTED', {
        order_id: orderId,
        user_id: user.id.slice(0, 8) + '***',
        checkout_session_id,
        amount,
        currency,
      });

      // Fetch bank transfer settings
      const { data: bankSettings } = await supabase
        .from('settings')
        .select('bank_name, bank_account_holder, bank_account_number, bank_iban, bank_swift, bank_address, bank_instructions_en, bank_instructions_fr')
        .limit(1)
        .maybeSingle();

      const transferReference = `AFRISHOP-${orderId.slice(0, 8).toUpperCase()}`;

      const bankTransferInfo = {
        bank_name: bankSettings?.bank_name || 'Contact support for bank details',
        beneficiary_name: bankSettings?.bank_account_holder || 'AfriShop USA LLC',
        account_number_or_iban: bankSettings?.bank_account_number || bankSettings?.bank_iban || '',
        swift_bic: bankSettings?.bank_swift || '',
        reference: transferReference,
        instructions_en: bankSettings?.bank_instructions_en || 'Please transfer the exact amount and include your order ID in the reference.',
        instructions_fr: bankSettings?.bank_instructions_fr || 'Veuillez transférer le montant exact et inclure votre numéro de commande dans la référence.',
      };

      // Update payment_attempt
      await supabase
        .from('payment_attempts')
        .update({
          provider_ref: transferReference,
          status: 'pending',
        })
        .eq('id', paymentAttempt!.id);

      // Update checkout session
      await supabase
        .from('checkout_sessions')
        .update({
          status: 'initiated',
          provider_triggered_at: new Date().toISOString(),
        })
        .eq('id', checkout_session_id);

      // Update order status
      await supabase
        .from('orders')
        .update({
          status: 'PENDING_PAYMENT',
          maisha_payment_status: 'PENDING_BANK_TRANSFER',
          payment_notes: `Awaiting bank transfer. Reference: ${transferReference}`,
        })
        .eq('id', orderId);

      console.log('[PAYMENT_FLOW] BANK_TRANSFER_INITIATED', {
        order_id: orderId,
        reference: transferReference,
        payment_attempt_id: paymentAttempt!.id,
      });

      return jsonResponse({
        success: true,
        provider: 'bank_transfer',
        payment_attempt_id: paymentAttempt!.id,
        order_id: orderId,
        checkout_session_id,
        reference: transferReference,
        bank_transfer: bankTransferInfo,
        status: 'pending_user_confirmation',
        message: 'Please complete the bank transfer and upload proof of payment.',
        message_fr: 'Veuillez effectuer le virement bancaire et télécharger la preuve de paiement.',
        amount,
        currency,
      });
    }

    // Should never reach here
    return jsonResponse({
      ok: false,
      success: false,
      code: 'UNKNOWN_PROVIDER',
      message: 'Unknown provider selected.',
      message_fr: 'Fournisseur inconnu sélectionné.',
    }, 200);

  } catch (error: any) {
    console.error('[PAYMENT_FLOW] UNEXPECTED_ERROR', error.message);
    
    return jsonResponse({
      ok: false,
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      message_fr: 'Une erreur inattendue s\'est produite.',
    }, 200);
  }
});
