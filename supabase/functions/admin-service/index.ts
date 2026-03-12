/**
 * admin-service — Consolidated Admin Function (INLINED)
 *
 * Actions:
 *   order_action, delete_order, bulk_delete_orders, update_item_status,
 *   invite_user, system_health, get_carts, ai_assistant, reset_section,
 *   catalog_settings, predict_ltv, ai_actions_review, execute_ai_action,
 *   reloadly_topup
 *
 * AUTH: All actions require a valid JWT + admin role.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { createErrorResponse } from "../_shared/errorSanitizer.ts";
import { verifyAndGetUser, errorResponse, handleCors, createAdminClient } from "../_shared/auth.ts";
import { getCatalogSettings, updateCatalogSetting } from "../_shared/catalogSettings.ts";
import { invalidateTtlPolicyCache } from "../_shared/ttlPolicy.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function createUserClientFromReq(req: Request) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  );
}

interface AdminAuth {
  user: any;
  userId: string;
  adminRole: string;
  supabaseUser: any;
  supabaseAdmin: any;
}

async function requireAdmin(req: Request): Promise<AdminAuth | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const supabaseAdmin = createServiceClient();
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const { data: roleData } = await supabaseAdmin
    .from('user_roles')
    .select('role, admin_role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle();

  if (!roleData) {
    return jsonRes({ error: 'Admin access required' }, 403);
  }

  const supabaseUser = createUserClientFromReq(req);

  return {
    user,
    userId: user.id,
    adminRole: roleData.admin_role || 'support',
    supabaseUser,
    supabaseAdmin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: order_action
// ═══════════════════════════════════════════════════════════════════════════════

async function handleOrderAction(auth: AdminAuth, body: any): Promise<Response> {
  const { orderId, actionType, message, metadata } = body;
  const supabase = auth.supabaseUser;

  let orderUpdate: any = { updated_at: new Date().toISOString() };
  switch (actionType) {
    case 'APPROVED':
      orderUpdate.status = 'PROCESSING';
      orderUpdate.approved_at = new Date().toISOString();
      orderUpdate.approved_by = auth.userId;
      break;
    case 'REJECTED':
      orderUpdate.status = 'CANCELLED';
      orderUpdate.rejected_at = new Date().toISOString();
      orderUpdate.rejected_by = auth.userId;
      orderUpdate.rejection_reason = message;
      break;
    case 'INFO_REQUESTED':
      orderUpdate.info_requested = true;
      break;
    case 'PAYMENT_VERIFIED':
      orderUpdate.status = 'PAID';
      orderUpdate.payment_verified_at = new Date().toISOString();
      break;
    case 'SHIPPED':
      orderUpdate.status = 'SHIPPED';
      break;
    case 'DELIVERED':
      orderUpdate.status = 'COMPLETED';
      break;
    case 'NOTE_ADDED':
      orderUpdate.admin_notes = metadata?.note || message;
      break;
  }

  const { error: updateError } = await supabase.from('orders').update(orderUpdate).eq('id', orderId);
  if (updateError) throw updateError;

  const { error: actionError } = await supabase.from('order_actions').insert({
    order_id: orderId,
    actor_id: auth.userId,
    action_type: actionType,
    action_message: message,
    metadata: metadata || {},
  });
  if (actionError) throw actionError;

  return jsonRes({ success: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: delete_order
// ═══════════════════════════════════════════════════════════════════════════════

async function handleDeleteOrder(auth: AdminAuth, body: any): Promise<Response> {
  const { orderId } = body;
  if (!orderId) return jsonRes({ error: 'Order ID is required' }, 400);

  const supabase = auth.supabaseAdmin;

  const { data: order, error: orderError } = await supabase
    .from('orders').select('id, status, user_id, total_usd, created_at').eq('id', orderId).maybeSingle();
  if (orderError) throw orderError;
  if (!order) return jsonRes({ error: 'Order not found' }, 404);

  // Delete related records
  await supabase.from('order_actions').delete().eq('order_id', orderId);
  await supabase.from('order_items').delete().eq('order_id', orderId);
  await supabase.from('payments').delete().eq('order_id', orderId);
  await supabase.from('payment_attempts').delete().eq('order_id', orderId);
  await supabase.from('checkout_sessions').delete().eq('order_id', orderId);

  const { data: sessions } = await supabase.from('manual_transfer_sessions').select('id').eq('order_id', orderId);
  if (sessions?.length) {
    await supabase.from('manual_transfer_proofs').delete().in('session_id', sessions.map((s: any) => s.id));
    await supabase.from('manual_transfer_sessions').delete().eq('order_id', orderId);
  }

  await supabase.from('bank_transfer_view_tokens').delete().eq('order_id', orderId);
  await supabase.from('payment_links').delete().eq('order_id', orderId);
  await supabase.from('cart_recovery_ab_tests').delete().eq('order_id', orderId);
  await supabase.from('cart_recovery_predictions').delete().eq('order_id', orderId);

  const { error: deleteError } = await supabase.from('orders').delete().eq('id', orderId);
  if (deleteError) throw deleteError;

  await supabase.from('admin_audit_logs').insert({
    admin_id: auth.userId, admin_email: auth.user.email,
    action_type: 'DELETE_ORDER', target_id: orderId, target_section: 'orders',
    details: { order_status: order.status, order_total_usd: order.total_usd, order_created_at: order.created_at, order_user_id: order.user_id },
  });

  return jsonRes({ success: true, message: 'Order deleted successfully' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: bulk_delete_orders
// ═══════════════════════════════════════════════════════════════════════════════

async function handleBulkDeleteOrders(auth: AdminAuth, body: any): Promise<Response> {
  const { orderIds } = body;
  if (!orderIds?.length) return jsonRes({ error: 'orderIds array is required' }, 400);
  if (orderIds.length > 100) return jsonRes({ error: 'Maximum 100 orders per batch' }, 400);

  const supabase = auth.supabaseAdmin;

  const { data: orders, error: ordersError } = await supabase
    .from('orders').select('id, status, user_id, total_usd, created_at').in('id', orderIds);
  if (ordersError) throw ordersError;

  const foundIds = (orders || []).map((o: any) => o.id);
  if (!foundIds.length) return jsonRes({ error: 'No orders found' }, 404);

  const { data: items } = await supabase.from('order_items').select('id').in('order_id', foundIds);
  const { data: sessions } = await supabase.from('manual_transfer_sessions').select('id').in('order_id', foundIds);

  if (items?.length) await supabase.from('quote_requests').delete().in('order_item_id', items.map((i: any) => i.id));
  if (sessions?.length) await supabase.from('manual_transfer_proofs').delete().in('session_id', sessions.map((s: any) => s.id));

  await Promise.all([
    supabase.from('order_actions').delete().in('order_id', foundIds),
    supabase.from('order_items').delete().in('order_id', foundIds),
    supabase.from('payments').delete().in('order_id', foundIds),
    supabase.from('checkout_sessions').delete().in('order_id', foundIds),
    supabase.from('payment_attempts').delete().in('order_id', foundIds),
    supabase.from('manual_transfer_sessions').delete().in('order_id', foundIds),
    supabase.from('bank_transfer_view_tokens').delete().in('order_id', foundIds),
    supabase.from('payment_links').delete().in('order_id', foundIds),
    supabase.from('cart_recovery_ab_tests').delete().in('order_id', foundIds),
    supabase.from('cart_recovery_predictions').delete().in('order_id', foundIds),
  ]);

  const { error: deleteError } = await supabase.from('orders').delete().in('id', foundIds);
  if (deleteError) throw deleteError;

  const auditLogs = (orders || []).map((order: any) => ({
    admin_id: auth.userId, admin_email: auth.user.email,
    action_type: 'DELETE_ORDER', target_id: order.id, target_section: 'orders',
    details: { order_status: order.status, order_total_usd: order.total_usd, bulk_delete: true, batch_size: foundIds.length },
  }));
  await supabase.from('admin_audit_logs').insert(auditLogs);

  return jsonRes({ success: true, deleted: foundIds.length, notFound: orderIds.length - foundIds.length });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: update_item_status
// ═══════════════════════════════════════════════════════════════════════════════

async function handleUpdateItemStatus(auth: AdminAuth, body: any): Promise<Response> {
  const supabase = auth.supabaseAdmin;
  const { item_id, order_id, shipping_status, send_email } = body;

  if (!item_id && !order_id) return jsonRes({ error: 'item_id or order_id required' }, 400);
  if (!shipping_status || !['pending', 'shipped', 'delivered'].includes(shipping_status)) {
    return jsonRes({ error: 'Valid shipping_status required (pending, shipped, delivered)' }, 400);
  }

  let updatedItems: any[] = [];
  let targetOrderId = order_id;

  if (item_id) {
    const { data: item, error } = await supabase
      .from('order_items').update({ shipping_status }).eq('id', item_id)
      .select('*, orders(id, user_id, status, profiles(name, email))').single();
    if (error) throw error;
    updatedItems = [item];
    targetOrderId = item.order_id;
  } else {
    const { data: items, error } = await supabase
      .from('order_items').update({ shipping_status }).eq('order_id', order_id).select('*');
    if (error) throw error;
    updatedItems = items || [];
  }

  const { data: order, error: orderError } = await supabase
    .from('orders').select('*, profiles(name, email), order_items(id, shipping_status)')
    .eq('id', targetOrderId).single();
  if (orderError) throw orderError;

  const allStatuses = order.order_items.map((i: any) => i.shipping_status);
  const allDelivered = allStatuses.every((s: string) => s === 'delivered');
  const allShipped = allStatuses.every((s: string) => s === 'shipped' || s === 'delivered');

  let newOrderStatus = order.status;
  if (allDelivered && order.status !== 'COMPLETED') newOrderStatus = 'COMPLETED';
  else if (allShipped && order.status !== 'SHIPPED' && order.status !== 'COMPLETED') newOrderStatus = 'SHIPPED';

  if (newOrderStatus !== order.status) {
    const updateData: any = { status: newOrderStatus };
    if (newOrderStatus === 'SHIPPED') updateData.shipped_at = new Date().toISOString();
    else if (newOrderStatus === 'COMPLETED') updateData.delivered_at = new Date().toISOString();
    await supabase.from('orders').update(updateData).eq('id', targetOrderId);
  }

  if (send_email && order.profiles?.email) {
    const emailType = shipping_status === 'shipped' ? 'shipped' : shipping_status === 'delivered' ? 'delivered' : null;
    if (emailType) {
      try {
        const invokeClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
        await invokeClient.functions.invoke(`send-order-${emailType}-email`, {
          body: { orderId: targetOrderId, customerEmail: order.profiles.email, customerName: order.profiles.name || 'Customer', items: updatedItems.map((i: any) => ({ title: i.title, quantity: i.quantity })) },
        });
      } catch (e: any) { console.error('[update_item_status] Email error:', e.message); }
    }
  }

  await supabase.from('order_actions').insert({
    order_id: targetOrderId, actor_id: auth.userId, action_type: 'ITEM_STATUS_UPDATE',
    action_message: `Updated ${item_id ? '1 item' : 'all items'} to ${shipping_status}`,
    metadata: { item_id, shipping_status, send_email, updated_count: updatedItems.length },
  });

  return jsonRes({ success: true, updatedCount: updatedItems.length, orderStatus: newOrderStatus });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: invite_user
// ═══════════════════════════════════════════════════════════════════════════════

const adminRoles = ['super_admin', 'operations', 'finance', 'support'] as const;
const inviteUserSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(adminRoles),
  permissions: z.record(z.boolean()).optional(),
  setPassword: z.string().min(8).max(128).optional(),
  resend: z.boolean().optional(),
  invitationId: z.string().uuid().optional(),
});

const defaultPermissions: Record<string, any> = {
  super_admin: { can_view_dashboard: true, can_view_orders: true, can_view_active_carts: true, can_view_saved_carts: true, can_view_ab_results: true, can_view_analytics: true, can_view_payments: true, can_view_shipping: true, can_manage_shipping_types: true, can_view_tickets: true, can_view_ticket_analytics: true, can_view_knowledge_base: true, can_manage_users: true, can_view_settings: true, can_view_theme_settings: true },
  operations: { can_view_dashboard: true, can_view_orders: true, can_view_active_carts: true, can_view_saved_carts: true, can_view_shipping: true },
  finance: { can_view_dashboard: true, can_view_ab_results: true, can_view_analytics: true, can_view_payments: true },
  support: { can_view_dashboard: true, can_view_orders: true, can_view_tickets: true, can_view_ticket_analytics: true, can_view_knowledge_base: true },
};

const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin (Full Access)',
  operations: 'Operations (Orders & Shipping)',
  finance: 'Finance (Payments & Analytics)',
  support: 'Support (Tickets & Help)',
};

async function sendInvitationEmail(email: string, role: string, token: string): Promise<{ sent: boolean; error?: string }> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
  const inviteUrl = `${frontendUrl}/accept-invite?token=${token}`;
  if (!RESEND_API_KEY) {
    console.error('[invite] RESEND_API_KEY not set');
    return { sent: false, error: 'Email service not configured' };
  }
  const roleLabel = roleLabels[role] || role;
  const fromAddress = 'AfriShop USA <noreply@afrishop-usa.com>';
  console.log(`[invite] Sending invitation email to ${email} from ${fromAddress}, role=${role}`);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: `AfriShop USA — Vous êtes invité(e) à rejoindre l'équipe admin`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
            <div style="text-align:center;padding:24px 0;">
              <img src="https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png" width="140" alt="AfriShop USA" style="display:inline-block;" />
            </div>
            <div style="padding:0 24px 24px;">
              <h2 style="color:#1a1a1a;margin:0 0 16px;">Vous êtes invité(e)!</h2>
              <p style="color:#333;line-height:1.6;">
                Vous avez été invité(e) à rejoindre <strong>AfriShop USA</strong> en tant qu'administrateur avec le rôle :
              </p>
              <div style="background:#f0f0ff;padding:12px 16px;border-radius:8px;margin:16px 0;border-left:4px solid #6366f1;">
                <strong style="color:#6366f1;">${roleLabel}</strong>
              </div>
              <p style="color:#333;line-height:1.6;">
                Cliquez sur le bouton ci-dessous pour accepter l'invitation, créer votre mot de passe et accéder au portail admin.
              </p>
              <div style="text-align:center;margin:24px 0;">
                <a href="${inviteUrl}" style="background:#6366f1;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block;font-size:16px;">Accepter l'invitation</a>
              </div>
              <p style="color:#888;font-size:13px;margin-top:24px;">
                Cette invitation expire dans 7 jours. Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.
              </p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
              <p style="color:#aaa;font-size:12px;text-align:center;">
                © AfriShop USA — Vos produits favoris, livrés en Afrique.
              </p>
            </div>
          </div>
        `,
      }),
    });
    const responseText = await response.text();
    console.log(`[invite] Resend response status=${response.status} body=${responseText}`);
    if (!response.ok) { return { sent: false, error: responseText }; }
    return { sent: true };
  } catch (err: any) {
    console.error(`[invite] Email send error:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function handleInviteUser(auth: AdminAuth, body: any): Promise<Response> {
  const supabaseUser = auth.supabaseUser;
  const serviceSupabase = auth.supabaseAdmin;
  const { email, role, permissions, setPassword, resend, invitationId } = body;
  const userPermissions = permissions || defaultPermissions[role] || defaultPermissions.support;

  // Handle resend
  if (resend && invitationId) {
    const { data: invitation, error: invErr } = await serviceSupabase
      .from('admin_invitations').select('*').eq('id', invitationId).single();
    if (invErr || !invitation) return jsonRes({ error: 'Invitation not found' }, 404);

    const newExpires = new Date(); newExpires.setDate(newExpires.getDate() + 7);
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const inviteUrl = `${frontendUrl}/accept-invite?token=${invitation.token}`;
    const emailResult = await sendInvitationEmail(invitation.email, invitation.role, invitation.token);
    await serviceSupabase.from('admin_invitations').update({ expires_at: newExpires.toISOString(), email_sent: emailResult.sent, invite_url: inviteUrl }).eq('id', invitationId);
    return jsonRes({ success: true, message: emailResult.sent ? 'Invitation resent' : 'Invitation updated', emailSent: emailResult.sent, inviteUrl });
  }

  // Validate
  const parsed = inviteUserSchema.safeParse(body);
  if (!parsed.success) return jsonRes({ error: (parsed as any).error?.errors?.map((e: any) => e.message).join(', ') || 'Validation failed' }, 400);

  // Check existing user via profiles table (listUsers not available in edge runtime)
  let existingUser = null;
  const { data: profileMatch } = await serviceSupabase
    .from('profiles')
    .select('user_id, email, full_name')
    .ilike('email', email.trim())
    .limit(1)
    .maybeSingle();
  if (profileMatch) {
    existingUser = { id: profileMatch.user_id, email: profileMatch.email };
  }

  if (existingUser) {
    const { data: existingRole } = await serviceSupabase
      .from('user_roles').select('*').eq('user_id', existingUser.id).eq('role', 'admin').single();
    if (existingRole) return jsonRes({ error: 'User is already an admin' }, 400);
    await serviceSupabase.from('user_roles').insert({ user_id: existingUser.id, role: 'admin', admin_role: role });
    await serviceSupabase.from('admin_user_permissions').upsert({ user_id: existingUser.id, ...userPermissions });
    return jsonRes({ success: true, message: 'Existing user promoted to admin', userId: existingUser.id });
  }

  // Create invitation
  const { data: invitation, error: inviteError } = await serviceSupabase
    .from('admin_invitations').insert({ email, role, invited_by: auth.userId }).select().single();
  if (inviteError) throw inviteError;

  if (invitation.token) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(invitation.token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    await serviceSupabase.from('admin_invitations').update({ token_hash: tokenHash }).eq('id', invitation.id);
  }

  if (setPassword) {
    const { data: newUser, error: createError } = await serviceSupabase.auth.admin.createUser({ email, password: setPassword, email_confirm: true, user_metadata: { full_name: email.split('@')[0], invited_admin: true } });
    if (createError) throw createError;
    await serviceSupabase.from('profiles').insert({ user_id: newUser.user.id, full_name: email.split('@')[0] });
    await serviceSupabase.from('user_roles').insert({ user_id: newUser.user.id, role: 'admin', admin_role: role });
    await serviceSupabase.from('admin_user_permissions').upsert({ user_id: newUser.user.id, ...userPermissions });
    await serviceSupabase.from('admin_invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invitation.id);
    return jsonRes({ success: true, message: 'Admin user created with password', userId: newUser.user.id });
  }

  const emailResult = await sendInvitationEmail(email, role, invitation.token);
  const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
  const inviteUrl = `${frontendUrl}/accept-invite?token=${invitation.token}`;
  await serviceSupabase.from('admin_invitations').update({ email_sent: emailResult.sent, invite_url: inviteUrl }).eq('id', invitation.id);

  return jsonRes({ success: true, invitationId: invitation.id, emailSent: emailResult.sent, inviteUrl });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: system_health
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSystemHealth(auth: AdminAuth): Promise<Response> {
  const supabase = auth.supabaseAdmin;
  const now = new Date();
  const monthKey = `amazon:month:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [cacheStats, tableStats, providerBudget, monthlyBudgetResult, ingestQueueStats] = await Promise.all([
    Promise.all([
      supabase.from('catalog_cache').select('*', { count: 'exact', head: true }),
      supabase.from('product_cache').select('*', { count: 'exact', head: true }),
      supabase.from('catalog_facets_cache').select('*', { count: 'exact', head: true }),
      supabase.from('rate_limits').select('*', { count: 'exact', head: true }),
    ]),
    supabase.rpc('get_table_statistics'),
    supabase.from('provider_budget').select('*').eq('provider', 'amazon').order('window_start', { ascending: false }).limit(1),
    supabase.from('provider_budget').select('call_count, limit_count').eq('window_key', monthKey).maybeSingle(),
    Promise.all([
      supabase.from('amazon_ingest_queue').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
      supabase.from('amazon_ingest_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    ]),
  ]);

  const [catalogCache, productCache, facetsCache, rateLimits] = cacheStats;
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
  const pawapayKey = Deno.env.get('PAWAPAY_API_TOKEN') || '';
  const ebayToken = Deno.env.get('EBAY_OAUTH_TOKEN') || '';
  const rainforestKey = Deno.env.get('RAINFOREST_API_KEY') || '';

  const amazonBudget = providerBudget.data?.[0];
  const amazonRemaining = amazonBudget ? Math.max(0, (amazonBudget.limit_count || 100) - (amazonBudget.call_count || 0)) : 100;
  const monthlyUsed = monthlyBudgetResult.data?.call_count || 0;
  const [queuedResult, failedResult] = ingestQueueStats;

  return jsonRes({
    ok: true, timestamp: new Date().toISOString(),
    circuits: {
      pawapay: { state: 'CLOSED', failures: 0, isAvailable: !!pawapayKey },
      stripe: { state: 'CLOSED', failures: 0, isAvailable: !!stripeKey },
      resend: { state: 'CLOSED', failures: 0, isAvailable: !!Deno.env.get('RESEND_API_KEY') },
      ebay: { state: 'CLOSED', failures: 0, isAvailable: !!ebayToken },
      rainforest: { state: 'CLOSED', failures: 0, isAvailable: !!rainforestKey },
    },
    cache: {
      catalogCacheCount: catalogCache.count || 0,
      productCacheCount: productCache.count || 0,
      facetsCacheCount: facetsCache.count || 0,
      rateLimitsCount: rateLimits.count || 0,
    },
    database: { tableStats: (tableStats.data || []).map((row: any) => ({ table: row.table_name, rowEstimate: row.row_estimate, seqScans: row.seq_scans, idxScans: row.idx_scans, indexUsagePct: row.index_usage_pct || 0 })) },
    providers: {
      ebay: { configured: !!ebayToken, tokenValid: !!ebayToken },
      amazon: { configured: !!rainforestKey, budgetRemaining: amazonRemaining, monthlyLimit: 10000, monthlyUsed, monthlyRemaining: Math.max(0, 10000 - monthlyUsed), queueQueuedCount: queuedResult.count || 0, queueFailedCount: failedResult.count || 0 },
      stripe: { configured: !!stripeKey, mode: stripeKey.startsWith('sk_live') ? 'live' : 'test' },
      pawapay: { configured: !!pawapayKey },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: get_carts
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_SORT_FIELDS = ['updated_at', 'created_at', 'total_usd', 'item_count'] as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

async function handleGetCarts(auth: AdminAuth, body: any, req: Request): Promise<Response> {
  const supabase = auth.supabaseUser;
  const url = new URL(req.url);
  const sortBy = (['updated_at', 'created_at', 'total_usd', 'item_count'].includes(body.sortBy || url.searchParams.get('sortBy') || '') ? (body.sortBy || url.searchParams.get('sortBy')) : 'updated_at') as string;
  const sortOrder = (body.sortOrder || url.searchParams.get('sortOrder') || 'desc') as string;
  const statusFilter = body.status || url.searchParams.get('status');
  const minTotal = body.minTotal || url.searchParams.get('minTotal');
  const userName = body.userName || url.searchParams.get('userName');

  const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
  const cachedSettings = await getCachedGlobalSettings(supabase) as Record<string, any>;
  const exchangeRate = cachedSettings?.exchange_rate_usd_to_cdf || 2800;
  const shippingFeeUsd = cachedSettings?.shipping_base_fee_usd || 10;
  const markupPercent = cachedSettings?.markup_percent ?? cachedSettings?.global_markup_percent ?? 15;

  const statusList = statusFilter ? [statusFilter] : ['DRAFT', 'PENDING_PAYMENT'];
  let query = supabase.from('orders').select(`id, user_id, status, item_total_usd, shipping_fee_usd, service_fee_usd, total_usd, total_cdf, exchange_rate_used, created_at, updated_at, profiles!orders_user_id_fkey(name, full_name, phone, signup_platform)`).in('status', statusList);
  if (minTotal) { const n = parseFloat(minTotal); if (!isNaN(n)) query = query.gte('total_usd', n); }
  if (sortBy !== 'item_count') query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  else query = query.order('updated_at', { ascending: false });

  const { data: carts, error: cartsError } = await query;
  if (cartsError) throw cartsError;

  let cartsWithItems = await Promise.all((carts || []).map(async (cart: any) => {
    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', cart.id);
    const profile = Array.isArray(cart.profiles) ? cart.profiles[0] : cart.profiles;
    let cartUserName = profile?.full_name || profile?.name || (profile?.phone ? `User (${profile.phone})` : 'Guest');

    const formattedItems = (items || []).map((item: any) => ({
      id: item.id, productTitle: item.title || 'Untitled Product', productUrl: item.product_url, productImageUrl: item.product_image_url, store: item.store,
      basePriceUsd: Number(item.base_price_usd || item.unit_price_usd || 0), markupFeeUsd: Number(item.markup_fee_usd || 0), shippingFeeUsd: Number(item.shipping_fee_usd || 0),
      subtotalUsd: Number(item.subtotal_usd || 0), totalPriceUsd: Number(item.total_price_usd || 0), totalPriceCdf: Number(item.total_price_cdf || 0), quantity: item.quantity || 1,
    }));

    let calcItemsTotal = 0, calcMarkupTotal = 0, calcSubtotalWithMarkup = 0;
    formattedItems.forEach((item: any) => {
      const base = item.subtotalUsd > 0 ? item.subtotalUsd : (item.basePriceUsd * item.quantity);
      const markup = item.markupFeeUsd > 0 ? item.markupFeeUsd : round2(base * (markupPercent / 100));
      const total = item.totalPriceUsd > 0 ? item.totalPriceUsd : round2(base + markup);
      calcItemsTotal += base; calcMarkupTotal += markup; calcSubtotalWithMarkup += total;
    });

    const hasItems = formattedItems.length > 0;
    const orderHasTotals = Number(cart.item_total_usd) > 0 || Number(cart.total_usd) > 0;
    const finalSubtotal = orderHasTotals && Number(cart.item_total_usd) > 0 ? Number(cart.item_total_usd) : round2(calcItemsTotal);
    const finalServiceFee = orderHasTotals && Number(cart.service_fee_usd) > 0 ? Number(cart.service_fee_usd) : round2(calcMarkupTotal);
    const finalShippingFee = orderHasTotals && Number(cart.shipping_fee_usd) > 0 ? Number(cart.shipping_fee_usd) : (hasItems ? shippingFeeUsd : 0);
    const finalTotalUsd = orderHasTotals && Number(cart.total_usd) > 0 ? Number(cart.total_usd) : round2(calcSubtotalWithMarkup + finalShippingFee);
    const finalTotalCdf = orderHasTotals && Number(cart.total_cdf) > 0 ? Number(cart.total_cdf) : round2(finalTotalUsd * exchangeRate);

    return {
      cartId: cart.id, userId: cart.user_id, userName: cartUserName, userPhone: profile?.phone || '', platform: profile?.signup_platform || 'unknown',
      status: cart.status, itemCount: formattedItems.length, subtotalUsd: round2(finalSubtotal), shippingFeeUsd: round2(finalShippingFee),
      serviceFeeUsd: round2(finalServiceFee), totalUsd: round2(finalTotalUsd), totalCdf: round2(finalTotalCdf),
      createdAt: cart.created_at, updatedAt: cart.updated_at, items: formattedItems,
    };
  }));

  if (userName) cartsWithItems = cartsWithItems.filter((c: any) => c.userName.toLowerCase().includes(userName.toLowerCase()));
  if (sortBy === 'item_count') cartsWithItems.sort((a: any, b: any) => sortOrder === 'asc' ? a.itemCount - b.itemCount : b.itemCount - a.itemCount);

  return jsonRes({ carts: cartsWithItems, sort: { field: sortBy, order: sortOrder }, appliedFilters: { status: statusFilter, minTotal: minTotal ? parseFloat(minTotal) : null, userName: userName || null } });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: ai_assistant
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['orders', 'payments', 'users', 'analytics', 'support', 'carts', 'settings'],
  finance: ['payments', 'analytics'],
  operations: ['orders', 'carts', 'shipping'],
  support: ['support', 'orders'],
};

async function handleAiAssistant(auth: AdminAuth, body: any): Promise<Response> {
  const supabase = auth.supabaseUser;
  const permissions = ROLE_PERMISSIONS[auth.adminRole] || [];
  const { query, conversationHistory } = body;

  if (!query || typeof query !== 'string') return jsonRes({ error: 'query is required' }, 400);
  if (query.length > 1500) return jsonRes({ error: 'query too long' }, 400);

  const sanitizedQuery = query.replace(/\x00/g, '').replace(/[\x01-\x1F\x7F]/g, '').replace(/\bignore\s+(previous|above|all)\s+instructions?\b/gi, '[filtered]').trim();

  let validatedHistory: Array<{ role: string; content: string }> = [];
  if (Array.isArray(conversationHistory)) {
    validatedHistory = conversationHistory.slice(-10).filter((msg: any) =>
      msg && typeof msg.role === 'string' && ['user', 'assistant', 'system'].includes(msg.role) && typeof msg.content === 'string' && msg.content.length <= 1500
    ).map((msg: any) => ({ role: msg.role, content: msg.content.replace(/\x00/g, '').trim().slice(0, 1500) }));
  }

  let dataContext = '';
  if (permissions.includes('orders')) {
    const { data: orders } = await supabase.from('orders').select('id, status, total_usd, payment_verified_at').limit(100);
    const paidOrders = orders?.filter((o: any) => o.payment_verified_at)?.length || 0;
    const revenue = orders?.filter((o: any) => o.payment_verified_at)?.reduce((sum: number, o: any) => sum + (o.total_usd || 0), 0) || 0;
    dataContext += `\n## Orders: ${orders?.length || 0} total, ${paidOrders} paid, $${revenue.toFixed(2)} revenue`;
  }
  if (permissions.includes('carts')) {
    const { data: carts } = await supabase.from('orders').select('id, total_usd').in('status', ['DRAFT', 'PENDING_PAYMENT']);
    dataContext += `\n## Carts: ${carts?.length || 0} active, $${(carts?.reduce((s: number, c: any) => s + (c.total_usd || 0), 0) || 0).toFixed(2)} value`;
  }
  if (permissions.includes('support')) {
    const { data: tickets } = await supabase.from('support_tickets').select('id, status, priority').limit(50);
    dataContext += `\n## Support: ${tickets?.length || 0} tickets, ${tickets?.filter((t: any) => t.priority === 'urgent' || t.priority === 'high')?.length || 0} urgent/high`;
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: `You are an AfriShop admin assistant. Role: ${auth.adminRole}. ${dataContext}` },
        ...validatedHistory,
        { role: 'user', content: sanitizedQuery },
      ],
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) return jsonRes({ error: 'Rate limit exceeded' }, 429);
    throw new Error(`AI API error: ${aiResponse.status}`);
  }
  const aiData = await aiResponse.json();
  return jsonRes({ response: aiData.choices?.[0]?.message?.content || 'No response', role: auth.adminRole, permissions });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: reset_section
// ═══════════════════════════════════════════════════════════════════════════════

async function handleResetSection(auth: AdminAuth, body: any): Promise<Response> {
  if (auth.adminRole !== 'super_admin') {
    return jsonRes({ error: 'Only super admins can reset sections.' }, 403);
  }

  const supabase = auth.supabaseAdmin;
  const { section, confirmationText } = body;
  const validSections = ['orders', 'payments', 'carts', 'tickets', 'order_actions'];
  if (!validSections.includes(section)) return jsonRes({ error: `Invalid section: ${section}` }, 400);

  const expected = `DELETE ALL ${section.toUpperCase()}`;
  if (confirmationText !== expected) return jsonRes({ error: `Confirmation text must be: ${expected}` }, 400);

  let deletedCount = 0;
  const deleteAll = (table: string) => supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');

  switch (section) {
    case 'orders':
      await deleteAll('order_items'); await deleteAll('order_actions'); await deleteAll('payments'); await deleteAll('payment_attempts');
      const { data: ordersData, error: ordersError } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id');
      if (ordersError) throw ordersError;
      deletedCount = ordersData?.length || 0;
      break;
    case 'payments':
      const { data: pData, error: pErr } = await deleteAll('payment_attempts').select('id');
      if (pErr) throw pErr;
      deletedCount = pData?.length || 0;
      break;
    case 'carts':
      const { data: cData } = await supabase.from('order_items').delete().eq('is_saved_for_later', false).select('id');
      deletedCount = cData?.length || 0;
      await supabase.from('orders').delete().eq('status', 'DRAFT');
      break;
    case 'tickets':
      await deleteAll('ticket_messages');
      const { data: tData, error: tErr } = await deleteAll('support_tickets').select('id');
      if (tErr) throw tErr;
      deletedCount = tData?.length || 0;
      break;
    case 'order_actions':
      const { data: aData, error: aErr } = await deleteAll('order_actions').select('id');
      if (aErr) throw aErr;
      deletedCount = aData?.length || 0;
      break;
  }

  await supabase.from('admin_audit_logs').insert({ admin_id: auth.userId, admin_email: auth.user.email, action_type: 'reset_section', target_section: section, details: { deleted_count: deletedCount } });
  return jsonRes({ success: true, section, deletedCount, message: `Successfully deleted ${deletedCount} ${section} records` });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: catalog_settings
// ═══════════════════════════════════════════════════════════════════════════════

const CATALOG_SETTING_KEYS = [
  "catalog_provider_mode", "amazon_enabled", "ebay_enabled", "amazon_max_results_per_query", "amazon_max_calls_per_hour",
  "amazon_budget_window", "mixed_amazon_first_count", "mixed_blend_ratio", "search_cache_ttl_seconds", "home_cache_ttl_seconds",
  "offers_cache_ttl_seconds", "negative_cache_ttl_seconds", "ebay_cache_ttl_seconds", "amazon_category_allowlist", "enable_category_rules",
  "media_cache_ttl_days", "media_prefetch_enabled", "media_prefetch_max_items_per_page", "media_fetch_timeout_ms", "media_fetch_concurrency",
  "amazon_live_search_enabled", "amazon_live_category_enabled", "amazon_live_home_enabled", "amazon_live_max_pages",
  "amazon_home_prewarm_enabled", "amazon_home_prewarm_interval_minutes", "amazon_home_prewarm_max_items_per_section",
  "amazon_query_generic_blocklist", "amazon_live_min_query_len",
  "home_rotation_interval_minutes", "home_rotation_mode", "home_avoid_repeat_days", "home_items_per_section", "ebay_home_cache_ttl_seconds",
  "global_max_item_age_days", "global_price_refresh_days", "global_availability_refresh_days", "db_search_min_results", "amazon_max_calls_per_month",
];

async function handleCatalogSettings(auth: AdminAuth, body: any, req: Request): Promise<Response> {
  const supabase = auth.supabaseUser;
  const method = body.method || req.method;

  if (method === 'GET' || body.subAction === 'get') {
    const settings = await getCatalogSettings(supabase);
    const { data: rawSettings } = await supabase.from('admin_settings').select('key, value, updated_at').in('key', CATALOG_SETTING_KEYS);
    const adminClient = createAdminClient();
    const { data: categoryTtl } = await adminClient.from('catalog_category_ttl').select('*');
    return jsonRes({ success: true, settings, raw: rawSettings || [], categoryTtl: categoryTtl || [] });
  }

  if (method === 'POST' || body.subAction === 'update') {
    const { updates } = body;
    if (!updates || typeof updates !== 'object') return jsonRes({ error: "Missing 'updates' object" }, 400);
    const results: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (!CATALOG_SETTING_KEYS.includes(key)) { results[key] = { success: false, error: `Invalid key: ${key}` }; continue; }
      results[key] = await updateCatalogSetting(supabase, key, value, auth.userId);
    }
    invalidateTtlPolicyCache();
    await supabase.from('admin_audit_logs').insert({ admin_id: auth.userId, action_type: 'UPDATE_CATALOG_SETTINGS', target_section: 'catalog_settings', details: { updates, results } });
    return jsonRes({ success: Object.values(results).every((r: any) => r.success), results });
  }

  if (method === 'PUT' || body.subAction === 'category_overrides') {
    const { categoryOverrides } = body;
    if (!Array.isArray(categoryOverrides)) return jsonRes({ error: "Missing 'categoryOverrides' array" }, 400);
    const adminClient = createAdminClient();
    const rows = categoryOverrides.map((ov: any) => ({
      category_key: ov.category_key, max_item_age_days: ov.max_item_age_days ?? null, price_refresh_days: ov.price_refresh_days ?? null,
      availability_refresh_days: ov.availability_refresh_days ?? null, db_min_results: ov.db_min_results ?? null,
      enabled: ov.enabled ?? true, updated_at: new Date().toISOString(), updated_by: auth.userId,
    }));
    const { error } = await adminClient.from('catalog_category_ttl').upsert(rows, { onConflict: 'category_key' });
    if (error) return jsonRes({ error: 'Failed to save: ' + error.message }, 500);
    invalidateTtlPolicyCache();
    return jsonRes({ success: true, saved: rows.length });
  }

  if (method === 'DELETE' || body.subAction === 'clear_overrides') {
    const adminClient = createAdminClient();
    await adminClient.from('catalog_category_ttl').delete().neq('category_key', '__never_match__');
    invalidateTtlPolicyCache();
    return jsonRes({ success: true, message: 'All category overrides cleared' });
  }

  return jsonRes({ error: 'Unknown catalog_settings subAction' }, 400);
}

// ─── Proxy Helper (for actions not yet inlined) ─────────────────────────────

async function proxyAdminToFunction(functionName: string, req: Request, body: any): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') || '');
  const { action: _a, ...payload } = body;
  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth gate: ALL admin actions require admin role
    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;
    const auth = authResult;

    if (req.method === 'GET') {
      return handleSystemHealth(auth);
    }

    const body = await req.json();
    const action = body.action;

    if (!action || typeof action !== 'string') {
      return jsonRes({ ok: false, error: 'Missing "action" field. Supported: order_action, delete_order, bulk_delete_orders, update_item_status, invite_user, system_health, get_carts, ai_assistant, reset_section, catalog_settings, predict_ltv, ai_actions_review, execute_ai_action, reloadly_topup' }, 400);
    }

    console.log(`[admin-service] action="${action}" user=${auth.user.email}`);

    switch (action) {
      case 'order_action':
        return handleOrderAction(auth, body);
      case 'delete_order':
        return handleDeleteOrder(auth, body);
      case 'bulk_delete_orders':
        return handleBulkDeleteOrders(auth, body);
      case 'update_item_status':
        return handleUpdateItemStatus(auth, body);
      case 'invite_user':
        return handleInviteUser(auth, body);
      case 'system_health':
        return handleSystemHealth(auth);
      case 'get_carts':
        return handleGetCarts(auth, body, req);
      case 'ai_assistant':
        return handleAiAssistant(auth, body);
      case 'reset_section':
        return handleResetSection(auth, body);
      case 'catalog_settings':
        return handleCatalogSettings(auth, body, req);
      case 'predict_ltv':
        return proxyAdminToFunction('predict-customer-ltv', req, body);
      case 'ai_actions_review':
        return proxyAdminToFunction('get-ai-actions-for-review', req, body);
      case 'execute_ai_action':
        return proxyAdminToFunction('execute-ai-action', req, body);
      case 'ai_order_assistant':
        return proxyAdminToFunction('ai-order-assistant', req, body);
      case 'reloadly_topup':
        return proxyAdminToFunction('reloadly-topup', req, body);
      default:
        return jsonRes({ ok: false, error: `Unknown action "${action}"` }, 400);
    }
  } catch (err: any) {
    return createErrorResponse(err, 'admin-service', corsHeaders);
  }
});
