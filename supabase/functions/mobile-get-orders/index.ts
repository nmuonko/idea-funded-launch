import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify JWT using SERVICE_ROLE
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-get-orders] User authenticated:', user.id);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const offset = (page - 1) * pageSize;

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, created_at, shipping_city, total_usd, total_cdf, status')
      .eq('user_id', user.id)
      .neq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('[mobile-get-orders] Query error:', error);
      throw error;
    }

    return jsonResponse(orders?.map(o => ({
      id: o.id,
      createdAt: o.created_at,
      shippingCity: o.shipping_city,
      totalUsd: o.total_usd,
      totalCdf: o.total_cdf,
      status: o.status,
    })) || []);

  } catch (error: any) {
    console.error('[mobile-get-orders] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse(error.message, 500);
  }
});
