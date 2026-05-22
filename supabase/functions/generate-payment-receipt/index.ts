import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";

// Check if user is admin
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  return !!data;
}

const LOGO_URL = "https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png";
const PLACEHOLDER_IMG = "https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png";

// Generate receipt HTML (French)
function generateReceiptHTML(order: any, items: any[], profile: any, userEmail: string): string {
  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'CDF') {
      return `${amount?.toLocaleString('fr-CD') || 0} CDF`;
    }
    const v = Number(amount || 0).toFixed(2);
    return `${v} $US`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/D';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const itemsHTML = items.map(item => {
    const img = item.product_image_url || PLACEHOLDER_IMG;
    const qty = item.quantity || 1;
    const unit = Number(item.unit_price_usd || (item.total_price_usd / qty) || 0).toFixed(2);
    return `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee; width: 88px;">
        <img src="${img}" alt="${(item.title || 'Produit').replace(/"/g,'&quot;')}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #eee;" onerror="this.src='${PLACEHOLDER_IMG}'"/>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <div style="font-weight: 500; color:#111;">${item.title || 'Produit'}</div>
        <div style="font-size: 12px; color: #666; margin-top:4px;">Quantité : <strong>${qty}</strong></div>
        <div style="font-size: 12px; color: #666;">Prix unitaire : ${unit} $US</div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; white-space:nowrap;">
        ${formatCurrency(item.total_price_usd, 'USD')}
      </td>
    </tr>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Reçu de paiement - AfriShop</title>
  <style>
    @media print {
      body { margin: 0; padding: 20px; background:#fff !important; }
      .no-print { display: none; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f5f5f5;
    }
    .receipt { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
    .logo-img { height: 56px; width: auto; margin-bottom: 12px; }
    .receipt-title { font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 2px; }
    .status-badge { display: inline-block; padding: 6px 16px; background: #22c55e; color: white; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
    .info-section h3 { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .info-section p { margin: 4px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { text-align: left; padding: 12px; background: #f8f9fa; font-size: 12px; text-transform: uppercase; color: #666; letter-spacing: 1px; }
    th:last-child { text-align: right; }
    .totals { margin-top: 20px; padding-top: 20px; border-top: 2px solid #eee; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .total-row.grand { font-size: 18px; font-weight: bold; color: #2563eb; border-top: 2px solid #2563eb; margin-top: 10px; padding-top: 15px; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
    .transaction-id { font-family: monospace; background: #f0f0f0; padding: 8px 12px; border-radius: 4px; font-size: 13px; word-break: break-all; }
    .print-btn { display: block; width: 220px; margin: 20px auto; padding: 12px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <img src="${LOGO_URL}" alt="AfriShop" class="logo-img" />
      <div class="receipt-title">Reçu de paiement</div>
      <div class="status-badge">✓ PAYÉ</div>
    </div>

    <div class="info-grid">
      <div class="info-section">
        <h3>Détails de la commande</h3>
        <p><strong>N° de commande :</strong> #${order.id.slice(0, 8).toUpperCase()}</p>
        <p><strong>Date :</strong> ${formatDate(order.payment_verified_at || order.updated_at)}</p>
        <p><strong>Statut :</strong> ${order.status}</p>
      </div>
      <div class="info-section">
        <h3>Client</h3>
        <p><strong>Nom :</strong> ${profile?.full_name || profile?.name || 'Client'}</p>
        <p><strong>Email :</strong> ${userEmail}</p>
        ${profile?.phone ? `<p><strong>Téléphone :</strong> ${profile.phone}</p>` : ''}
      </div>
    </div>

    <div class="info-section" style="margin-bottom:20px;">
      <h3>Référence de paiement</h3>
      <div class="transaction-id">${order.operator_ref_id || 'N/D'}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th colspan="2">Article</th>
          <th style="text-align:right;">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHTML}
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row">
        <span>Sous-total</span>
        <span>${formatCurrency(order.item_total_usd, 'USD')}</span>
      </div>
      <div class="total-row">
        <span>Frais de service</span>
        <span>${formatCurrency(order.service_fee_usd, 'USD')}</span>
      </div>
      <div class="total-row">
        <span>Livraison</span>
        <span>${formatCurrency(order.shipping_fee_usd, 'USD')}</span>
      </div>
      <div class="total-row grand">
        <span>Total ($US)</span>
        <span>${formatCurrency(order.total_usd, 'USD')}</span>
      </div>
      <div class="total-row">
        <span>Total (CDF)</span>
        <span>${formatCurrency(order.total_cdf, 'CDF')}</span>
      </div>
      <div class="total-row" style="font-size: 12px; color: #666;">
        <span>Taux de change</span>
        <span>1 $US = ${order.exchange_rate_used?.toLocaleString('fr-FR') || '2 800'} CDF</span>
      </div>
    </div>

    <div class="footer">
      <p>Merci d'avoir commandé sur AfriShop !</p>
      <p>Pour toute assistance, contactez-nous à nkadimisha@afrishop-usa.com</p>
      <p style="margin-top: 10px; font-size: 10px;">
        Reçu généré le ${formatDate(new Date().toISOString())}
      </p>
    </div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">
    🖨️ Imprimer le reçu
  </button>
</body>
</html>
  `;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[generate-payment-receipt] User:', user.id);

    // Check if user is admin
    const userIsAdmin = await isAdmin(supabase, user.id);
    console.log('[generate-payment-receipt] Is admin:', userIsAdmin);

    // Get order_id from query params or body
    let orderId: string | null = null;
    
    if (req.method === 'GET') {
      const url = new URL(req.url);
      orderId = url.searchParams.get('order_id');
    } else {
      const body = await req.json();
      orderId = body.order_id;
    }

    if (!orderId) {
      return errorResponse('order_id is required', 400);
    }

    // Get order - admins can access any order, users only their own
    let orderQuery = supabase
      .from('orders')
      .select('*')
      .eq('id', orderId);
    
    if (!userIsAdmin) {
      orderQuery = orderQuery.eq('user_id', user.id);
    }

    const { data: order, error: orderError } = await orderQuery.maybeSingle();

    if (orderError) {
      console.error('[generate-payment-receipt] DB error:', orderError);
      return errorResponse('Failed to fetch order', 500);
    }

    if (!order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
    }

    // Check if order is paid
    const isPaid = order.status === 'PAID' || 
                   order.status === 'PROCESSING' || 
                   order.status === 'SHIPPED' || 
                   order.status === 'READY_FOR_PICKUP' || 
                   order.status === 'COMPLETED' ||
                   false;

    if (!isPaid) {
      return jsonResponse({ 
        error: 'NOT_PAID', 
        message: 'Receipt only available for paid orders' 
      }, 400);
    }

    // Get order items
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('[generate-payment-receipt] Items error:', itemsError);
    }

    // Get customer profile (for the order owner, not the requesting user)
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, name, phone')
      .eq('user_id', order.user_id)
      .maybeSingle();

    // Check if JSON response requested
    const url = new URL(req.url);
    const format = url.searchParams.get('format');

    if (format === 'json') {
      return jsonResponse({
        success: true,
        receipt: {
          order_id: order.id,
          order_number: order.id.slice(0, 8).toUpperCase(),
          status: order.status,
          payment_status: order.status === 'PAID' ? 'SUCCESS' : order.status,
          transaction_id: order.operator_ref_id,
          paid_at: order.payment_verified_at || order.updated_at,
          customer: {
            name: profile?.full_name || profile?.name || 'Customer',
            email: user.email,
            phone: profile?.phone,
          },
          items: items?.map(item => ({
            title: item.title,
            quantity: item.quantity,
            unit_price_usd: item.unit_price_usd,
            total_price_usd: item.total_price_usd,
          })) || [],
          totals: {
            subtotal_usd: order.item_total_usd,
            service_fee_usd: order.service_fee_usd,
            shipping_fee_usd: order.shipping_fee_usd,
            total_usd: order.total_usd,
            total_cdf: order.total_cdf,
            exchange_rate: order.exchange_rate_used,
          },
        },
      });
    }

    // Generate HTML receipt
    const html = generateReceiptHTML(order, items || [], profile, user.email || '');

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error: any) {
    console.error('[generate-payment-receipt] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ error: 'INTERNAL_ERROR', message: error.message }, 500);
  }
});
