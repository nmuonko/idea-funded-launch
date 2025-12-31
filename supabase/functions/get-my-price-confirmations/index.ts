import { corsHeaders, handleCors, verifyAndGetUser, errorResponse, jsonResponse, AuthError } from '../_shared/auth.ts';

const ALLOWED_STATUSES = ['PENDING', 'APPROVED', 'ADJUSTED', 'REJECTED'];

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify authentication
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[get-my-price-confirmations] User:', user.id);

    // Parse query parameters
    const url = new URL(req.url);
    const statusParam = url.searchParams.get('status');

    // Build query
    let query = supabase
      .from('price_confirmations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Apply status filter if provided
    if (statusParam) {
      const status = statusParam.toUpperCase();
      if (!ALLOWED_STATUSES.includes(status)) {
        return errorResponse(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`, 400);
      }
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[get-my-price-confirmations] Query error:', error);
      return errorResponse('Failed to fetch price confirmations', 500);
    }

    console.log('[get-my-price-confirmations] Found:', data?.length ?? 0, 'confirmations');

    return jsonResponse({
      success: true,
      confirmations: data ?? [],
      count: data?.length ?? 0,
    });

  } catch (error) {
    console.error('[get-my-price-confirmations] Error:', error);
    
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
