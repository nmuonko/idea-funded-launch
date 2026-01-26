/**
 * Email Templates for AfriShop / AfriFund
 * 
 * All templates return { subject, html, text? } for use with sendEmail()
 * 
 * To add new email types:
 * 1. Create a new function following the pattern below
 * 2. Return an object with subject and html
 * 3. Optionally provide custom plain text (otherwise html is auto-converted)
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

// Common styles
const baseStyles = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  color: #374151;
`;

const headerStyle = `
  background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
  padding: 30px;
  text-align: center;
`;

const footerStyle = `
  background: #1e3a5f;
  padding: 20px;
  text-align: center;
  color: white;
  font-size: 12px;
`;

const buttonStyle = `
  display: inline-block;
  padding: 12px 24px;
  background: #2563eb;
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
`;

/**
 * Test email to verify Resend integration
 */
export function buildTestEmail(recipientName?: string): EmailTemplate {
  return {
    subject: "✅ Resend Integration Test - AfriShop",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Resend Integration Working!</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello${recipientName ? ` ${recipientName}` : ''},</p>
          <p>This is a test email to confirm that the Resend email integration is working correctly for AfriShop / AfriFund.</p>
          <p>If you received this email, the integration is successful! 🎉</p>
          <p style="color: #6b7280; font-size: 14px;">
            Sent at: ${new Date().toISOString()}
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Welcome email for new user registration
 */
export function buildWelcomeEmail(userName: string, userEmail: string): EmailTemplate {
  return {
    subject: "Welcome to AfriShop! 🛒",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Welcome to AfriShop!</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${userName || 'there'},</p>
          <p>Thank you for creating an account with AfriShop! We're excited to have you join our community of shoppers connecting the USA and DRC.</p>
          <p>With AfriShop, you can:</p>
          <ul>
            <li>Shop from top US retailers (Amazon, Walmart, eBay, and more)</li>
            <li>Get products delivered to DRC</li>
            <li>Track your orders in real-time</li>
            <li>Enjoy secure mobile payments</li>
          </ul>
          <p>Your registered email: <strong>${userEmail}</strong></p>
          <p style="margin-top: 20px;">
            Ready to start shopping? Browse our supported stores and find great products!
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order confirmation email
 */
export function buildOrderConfirmationEmail(params: {
  customerName: string;
  orderId: string;
  orderRef: string;
  items: Array<{ title: string; quantity: number; price: number }>;
  totalUsd: number;
  totalCdf?: number;
  paymentMethod?: string;
}): EmailTemplate {
  const { customerName, orderId, orderRef, items, totalUsd, totalCdf, paymentMethod } = params;
  
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.title}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  return {
    subject: `Order Confirmation - ${orderRef} | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Order Confirmed! 🎉</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${customerName},</p>
          <p>Thank you for your order! We've received your order and will begin processing it shortly.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Order Details</h2>
            <p><strong>Order Reference:</strong> ${orderRef}</p>
            <p><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>
            ${paymentMethod ? `<p><strong>Payment Method:</strong> ${paymentMethod}</p>` : ''}
          </div>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background: #1e3a5f; color: white;">
                <th style="padding: 10px; text-align: left;">Item</th>
                <th style="padding: 10px; text-align: center;">Qty</th>
                <th style="padding: 10px; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr style="background: #f3f4f6; font-weight: bold;">
                <td colspan="2" style="padding: 10px;">Total</td>
                <td style="padding: 10px; text-align: right;">$${totalUsd.toFixed(2)}${totalCdf ? ` (${totalCdf.toLocaleString()} CDF)` : ''}</td>
              </tr>
            </tfoot>
          </table>

          <p>We'll send you another email when your order ships.</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Payment success email
 */
export function buildPaymentSuccessEmail(params: {
  customerName: string;
  confirmationCode: string;
  amountUsd: number;
  amountCdf?: number;
  transactionId?: string;
  orderId: string;
  frontendBaseUrl?: string;
}): EmailTemplate {
  const { customerName, confirmationCode, amountUsd, amountCdf, transactionId, orderId, frontendBaseUrl = 'https://afrishop-usa.com' } = params;

  return {
    subject: `Payment Received - ${confirmationCode} | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">✓ Payment Received!</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${customerName},</p>
          <p>Great news! We've received your payment successfully.</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Payment Confirmed</h2>
            <p style="margin: 5px 0;"><strong>Confirmation Code:</strong> ${confirmationCode}</p>
            <p style="margin: 5px 0;"><strong>Amount:</strong> $${amountUsd.toFixed(2)}${amountCdf ? ` (${amountCdf.toLocaleString()} CDF)` : ''}</p>
            ${transactionId ? `<p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>` : ''}
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>
          </div>

          <p>Your order is now being processed. We'll send you a shipping update soon!</p>
          
          <p style="margin-top: 20px;">
            <a href="${frontendBaseUrl}/track-order?code=${confirmationCode}" style="${buttonStyle}">
              Track Your Order
            </a>
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Payment failed email
 */
export function buildPaymentFailedEmail(params: {
  customerName: string;
  orderId: string;
  amountUsd: number;
  reason?: string;
}): EmailTemplate {
  const { customerName, orderId, amountUsd, reason } = params;

  return {
    subject: "Payment Issue - Action Required | AfriShop",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">Payment Issue</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${customerName},</p>
          <p>We encountered an issue processing your payment for order ${orderId.slice(0, 8)}.</p>
          
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Amount:</strong> $${amountUsd.toFixed(2)}</p>
            ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>

          <p>Please try again or contact our support team if you need assistance.</p>
          
          <p style="color: #6b7280; font-size: 14px;">
            If you believe this is an error, please contact us at nkadimisha@afrishop-usa.com
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order shipped email
 */
export function buildOrderShippedEmail(params: {
  customerName: string;
  orderId: string;
  items: Array<{ title: string; quantity: number }>;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
}): EmailTemplate {
  const { customerName, orderId, items, trackingNumber, carrier, estimatedDelivery } = params;

  const itemsList = items.map(item => `<li>${item.title} (x${item.quantity})</li>`).join('');

  return {
    subject: `Your Order Has Shipped! 📦 | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Your Order Has Shipped! 📦</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${customerName},</p>
          <p>Great news! Your order is on its way.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Shipping Details</h2>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>
            ${carrier ? `<p style="margin: 5px 0;"><strong>Carrier:</strong> ${carrier}</p>` : ''}
            ${trackingNumber ? `<p style="margin: 5px 0;"><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
            ${estimatedDelivery ? `<p style="margin: 5px 0;"><strong>Estimated Delivery:</strong> ${estimatedDelivery}</p>` : ''}
          </div>

          <h3>Items Shipped:</h3>
          <ul>${itemsList}</ul>

          <p>Thank you for shopping with AfriShop!</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order delivered email
 */
export function buildOrderDeliveredEmail(params: {
  customerName: string;
  orderId: string;
  deliveredAt: string;
}): EmailTemplate {
  const { customerName, orderId, deliveredAt } = params;

  return {
    subject: "Your Order Has Been Delivered! ✓ | AfriShop",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">✓ Order Delivered!</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Hello ${customerName},</p>
          <p>Your order has been successfully delivered!</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Delivery Confirmed</h2>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>
            <p style="margin: 5px 0;"><strong>Delivered on:</strong> ${new Date(deliveredAt).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>

          <p>We hope you love your purchase! If you have any questions or concerns, please don't hesitate to contact us.</p>
          
          <p>Thank you for shopping with AfriShop. We look forward to serving you again!</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order processing email - sent when admin starts processing the order
 */
export function buildOrderProcessingEmail(params: {
  customerName: string;
  orderId: string;
  items: Array<{ title: string; quantity: number }>;
}): EmailTemplate {
  const { customerName, orderId, items } = params;

  const itemsList = items.map(item => `<li>${item.title} (x${item.quantity})</li>`).join('');

  return {
    subject: `🔄 Votre commande est en cours de traitement / Your order is being processed | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">🔄 Order Being Processed</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p>Bonjour ${customerName},</p>
          <p>Bonne nouvelle ! Nous avons commencé à traiter votre commande. Notre équipe prépare vos articles pour l'expédition.</p>
          
          <p>Hello ${customerName},</p>
          <p>Good news! We've started processing your order. Our team is preparing your items for shipment.</p>
          
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #92400e;">Order In Progress / Commande en cours</h2>
            <p style="margin: 5px 0;"><strong>Order ID / N° de commande:</strong> ${orderId.slice(0, 8).toUpperCase()}</p>
            <p style="margin: 5px 0;"><strong>Status / Statut:</strong> Processing / En traitement</p>
          </div>

          <h3>Articles / Items:</h3>
          <ul>${itemsList}</ul>

          <p>Nous vous informerons dès que votre commande sera expédiée.</p>
          <p>We'll notify you as soon as your order ships.</p>
          
          <p>Merci pour votre confiance ! / Thank you for shopping with AfriShop!</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `,
  };
}

/**
 * Admin notification for new order/payment
 */
export function buildAdminNotificationEmail(params: {
  type: 'new_order' | 'payment_received' | 'quote_request' | 'error' | 'new_user';
  summary: string;
  details: Record<string, any>;
}): EmailTemplate {
  const { type, summary, details } = params;

  const typeLabels = {
    new_order: '🛒 New Order',
    payment_received: '💰 Payment Received',
    quote_request: '📋 Quote Request',
    error: '🚨 Error',
    new_user: '👤 New User',
  };

  const detailsHtml = Object.entries(details)
    .map(([key, value]) => `<p style="margin: 5px 0;"><strong>${key}:</strong> ${value}</p>`)
    .join('');

  return {
    subject: `${typeLabels[type]} - AfriShop Admin`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">${typeLabels[type]}</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <p><strong>${summary}</strong></p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Details</h3>
            ${detailsHtml}
          </div>

          <p style="color: #6b7280; font-size: 12px;">
            Received at: ${new Date().toISOString()}
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">AfriShop Admin Notification</p>
        </div>
      </div>
    `,
  };
}
