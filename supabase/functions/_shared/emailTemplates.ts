/**
 * Email Templates for AfriShop / AfriFund
 * 
 * All templates return { subject, html, text? } for use with sendEmail()
 * All customer-facing templates are bilingual: French first, English below.
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

const sectionDivider = `<hr style="margin: 25px 0; border: none; border-top: 1px solid #e5e7eb;" />`;
const enLabel = `<p style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">🇬🇧 English</p>`;
const frLabel = `<p style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">🇫🇷 Français</p>`;

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
    subject: "Bienvenue sur AfriShop! / Welcome to AfriShop! 🛒",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Bienvenue sur AfriShop!</h1>
          <p style="color: #93c5fd; margin: 8px 0 0;">Welcome to AfriShop!</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${userName || 'cher client'},</p>
          <p>Merci d'avoir créé un compte chez AfriShop ! Nous sommes ravis de vous accueillir dans notre communauté de shopping reliant les USA et la RDC.</p>
          <p>Avec AfriShop, vous pouvez :</p>
          <ul>
            <li>Acheter auprès des meilleurs détaillants américains (Amazon, Walmart, eBay, et plus)</li>
            <li>Recevoir vos produits en RDC</li>
            <li>Suivre vos commandes en temps réel</li>
            <li>Profiter de paiements mobiles sécurisés</li>
          </ul>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${userName || 'there'},</p>
          <p>Thank you for creating an account with AfriShop! We're excited to have you join our community of shoppers connecting the USA and DRC.</p>
          <p>With AfriShop, you can:</p>
          <ul>
            <li>Shop from top US retailers (Amazon, Walmart, eBay, and more)</li>
            <li>Get products delivered to DRC</li>
            <li>Track your orders in real-time</li>
            <li>Enjoy secure mobile payments</li>
          </ul>

          <p>Votre email / Your email: <strong>${userEmail}</strong></p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order confirmation email — Bilingual FR / EN
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

  const itemsTable = `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background: #1e3a5f; color: white;">
          <th style="padding: 10px; text-align: left;">Article / Item</th>
          <th style="padding: 10px; text-align: center;">Qté / Qty</th>
          <th style="padding: 10px; text-align: right;">Prix / Price</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        <tr style="background: #f3f4f6; font-weight: bold;">
          <td colspan="2" style="padding: 10px;">Total</td>
          <td style="padding: 10px; text-align: right;">$${totalUsd.toFixed(2)}${totalCdf ? ` (${totalCdf.toLocaleString()} CDF)` : ''}</td>
        </tr>
      </tfoot>
    </table>
  `;

  return {
    subject: `✅ Commande confirmée / Order Confirmed - ${orderRef} | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">Commande confirmée ! 🎉</h1>
          <p style="color: #93c5fd; margin: 8px 0 0;">Order Confirmed!</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Merci pour votre commande ! Nous l'avons bien reçue et allons commencer à la traiter sous peu.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Détails de la commande</h2>
            <p><strong>Référence :</strong> ${orderRef}</p>
            <p><strong>N° de commande :</strong> ${orderId.slice(0, 8)}</p>
            ${paymentMethod ? `<p><strong>Mode de paiement :</strong> ${paymentMethod}</p>` : ''}
          </div>

          ${itemsTable}

          <p>Nous vous enverrons un autre email lorsque votre commande sera expédiée.</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>Thank you for your order! We've received it and will begin processing it shortly.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Order Details</h2>
            <p><strong>Reference:</strong> ${orderRef}</p>
            <p><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>
            ${paymentMethod ? `<p><strong>Payment Method:</strong> ${paymentMethod}</p>` : ''}
          </div>

          <p>We'll send you another email when your order ships.</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Payment success email — Bilingual FR / EN
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
  const { customerName, confirmationCode, amountUsd, amountCdf, transactionId, orderId, frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com' } = params;

  return {
    subject: `💰 Paiement reçu / Payment Received - ${confirmationCode} | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">✓ Paiement reçu !</h1>
          <p style="color: #93c5fd; margin: 8px 0 0;">Payment Received!</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Bonne nouvelle ! Nous avons reçu votre paiement avec succès.</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Paiement confirmé</h2>
            <p style="margin: 5px 0;"><strong>Code de confirmation :</strong> ${confirmationCode}</p>
            <p style="margin: 5px 0;"><strong>Montant :</strong> $${amountUsd.toFixed(2)}${amountCdf ? ` (${amountCdf.toLocaleString()} CDF)` : ''}</p>
            ${transactionId ? `<p style="margin: 5px 0;"><strong>ID de transaction :</strong> ${transactionId}</p>` : ''}
          </div>

          <p>Votre commande est maintenant en cours de traitement. Nous vous enverrons une mise à jour d'expédition bientôt !</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>Great news! We've received your payment successfully.</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Payment Confirmed</h2>
            <p style="margin: 5px 0;"><strong>Confirmation Code:</strong> ${confirmationCode}</p>
            <p style="margin: 5px 0;"><strong>Amount:</strong> $${amountUsd.toFixed(2)}${amountCdf ? ` (${amountCdf.toLocaleString()} CDF)` : ''}</p>
            ${transactionId ? `<p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>` : ''}
          </div>

          <p>Your order is now being processed. We'll send you a shipping update soon!</p>
          
          <p style="margin-top: 20px; text-align: center;">
            <a href="${frontendBaseUrl}/track-order?code=${confirmationCode}" style="${buttonStyle}">
              Suivre ma commande / Track Your Order
            </a>
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Payment failed email — Bilingual FR / EN
 */
export function buildPaymentFailedEmail(params: {
  customerName: string;
  orderId: string;
  amountUsd: number;
  reason?: string;
}): EmailTemplate {
  const { customerName, orderId, amountUsd, reason } = params;

  return {
    subject: "❌ Problème de paiement / Payment Issue - Action Required | AfriShop",
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">Problème de paiement</h1>
          <p style="color: #fca5a5; margin: 8px 0 0;">Payment Issue</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Nous avons rencontré un problème lors du traitement de votre paiement pour la commande ${orderId.slice(0, 8)}.</p>
          
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Montant :</strong> $${amountUsd.toFixed(2)}</p>
            ${reason ? `<p style="margin: 5px 0;"><strong>Raison :</strong> ${reason}</p>` : ''}
          </div>

          <p>Veuillez réessayer ou contacter notre équipe d'assistance si vous avez besoin d'aide.</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>We encountered an issue processing your payment for order ${orderId.slice(0, 8)}.</p>
          
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Amount:</strong> $${amountUsd.toFixed(2)}</p>
            ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>

          <p>Please try again or contact our support team if you need assistance.</p>
          
          <p style="color: #6b7280; font-size: 14px;">
            Contact : nkadimisha@afrishop-usa.com
          </p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order shipped email — Bilingual FR / EN
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
  const orderRef = orderId.substring(0, 8).toUpperCase();
  const itemsList = items.map(item => `<li>${item.title} (x${item.quantity})</li>`).join('');

  return {
    subject: `🚚 Commande #${orderRef} expédiée / Order Shipped | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">🚚 Commande expédiée !</h1>
          <p style="color: #93c5fd; margin: 8px 0 0;">Your Order Has Shipped!</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Bonne nouvelle ! Votre commande <strong>#${orderRef}</strong> est en route.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Détails d'expédition</h2>
            <p style="margin: 5px 0;"><strong>N° de commande :</strong> ${orderRef}</p>
            ${carrier ? `<p style="margin: 5px 0;"><strong>Transporteur :</strong> ${carrier}</p>` : ''}
            ${trackingNumber ? `<p style="margin: 5px 0;"><strong>N° de suivi :</strong> ${trackingNumber}</p>` : ''}
            ${estimatedDelivery ? `<p style="margin: 5px 0;"><strong>Livraison estimée :</strong> ${estimatedDelivery}</p>` : ''}
          </div>

          <h3>Articles expédiés :</h3>
          <ul>${itemsList}</ul>

          <p>Nous vous informerons dès que votre commande arrivera.</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>Great news! Your order <strong>#${orderRef}</strong> is on its way.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #1e3a5f;">Shipping Details</h2>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderRef}</p>
            ${carrier ? `<p style="margin: 5px 0;"><strong>Carrier:</strong> ${carrier}</p>` : ''}
            ${trackingNumber ? `<p style="margin: 5px 0;"><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
            ${estimatedDelivery ? `<p style="margin: 5px 0;"><strong>Estimated Delivery:</strong> ${estimatedDelivery}</p>` : ''}
          </div>

          <h3>Items Shipped:</h3>
          <ul>${itemsList}</ul>

          <p>We'll notify you when your order arrives.</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order delivered email — Bilingual FR / EN
 */
export function buildOrderDeliveredEmail(params: {
  customerName: string;
  orderId: string;
  deliveredAt: string;
}): EmailTemplate {
  const { customerName, orderId, deliveredAt } = params;
  const orderRef = orderId.substring(0, 8).toUpperCase();
  const deliveredDate = new Date(deliveredAt).toLocaleDateString('fr-FR', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const deliveredDateEn = new Date(deliveredAt).toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return {
    subject: `✅ Commande #${orderRef} livrée / Order Delivered | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">✓ Commande livrée !</h1>
          <p style="color: #a7f3d0; margin: 8px 0 0;">Order Delivered!</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Votre commande a été livrée avec succès !</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Livraison confirmée</h2>
            <p style="margin: 5px 0;"><strong>N° de commande :</strong> ${orderRef}</p>
            <p style="margin: 5px 0;"><strong>Livrée le :</strong> ${deliveredDate}</p>
          </div>

          <p>Nous espérons que vous apprécierez votre achat ! Si vous avez des questions, n'hésitez pas à nous contacter.</p>
          <p>Merci d'avoir choisi AfriShop. Au plaisir de vous servir à nouveau !</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>Your order has been successfully delivered!</p>
          
          <div style="background: #dcfce7; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #166534;">Delivery Confirmed</h2>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderRef}</p>
            <p style="margin: 5px 0;"><strong>Delivered on:</strong> ${deliveredDateEn}</p>
          </div>

          <p>We hope you love your purchase! If you have any questions, please don't hesitate to contact us.</p>
          <p>Thank you for shopping with AfriShop. We look forward to serving you again!</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Order processing email — Bilingual FR / EN (already was bilingual, cleaning up)
 */
export function buildOrderProcessingEmail(params: {
  customerName: string;
  orderId: string;
  items: Array<{ title: string; quantity: number }>;
}): EmailTemplate {
  const { customerName, orderId, items } = params;
  const orderRef = orderId.substring(0, 8).toUpperCase();
  const itemsList = items.map(item => `<li>${item.title} (x${item.quantity})</li>`).join('');

  return {
    subject: `🔄 Commande #${orderRef} en traitement / Order Processing | AfriShop`,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">🔄 Commande en traitement</h1>
          <p style="color: #93c5fd; margin: 8px 0 0;">Order Being Processed</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${frLabel}
          <p>Bonjour ${customerName},</p>
          <p>Bonne nouvelle ! Nous avons commencé à traiter votre commande <strong>#${orderRef}</strong>. Notre équipe prépare vos articles pour l'expédition.</p>
          
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #92400e;">Commande en cours</h2>
            <p style="margin: 5px 0;"><strong>N° de commande :</strong> ${orderRef}</p>
            <p style="margin: 5px 0;"><strong>Statut :</strong> En traitement</p>
          </div>

          <h3>Articles :</h3>
          <ul>${itemsList}</ul>

          <p>Nous vous informerons dès que votre commande sera expédiée.</p>

          ${sectionDivider}
          ${enLabel}
          <p>Hello ${customerName},</p>
          <p>Good news! We've started processing your order <strong>#${orderRef}</strong>. Our team is preparing your items for shipment.</p>
          
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #92400e;">Order In Progress</h2>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> ${orderRef}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> Processing</p>
          </div>

          <h3>Items:</h3>
          <ul>${itemsList}</ul>

          <p>We'll notify you as soon as your order ships.</p>
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}

/**
 * Admin notification for new order/payment (admin-only, no need for bilingual)
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

/**
 * Supported languages for assistance emails
 */
export type AssistanceEmailLanguage = 'en' | 'fr' | 'sw' | 'ln' | 'en_sw';

/**
 * Order assistance email - personalized email for incomplete orders with language selection
 */
export function buildOrderAssistanceEmail(params: {
  customerName: string;
  orderId: string;
  itemCount: number;
  totalUsd: number;
  frontendBaseUrl?: string;
  language?: AssistanceEmailLanguage;
  supportWhatsapp?: string;
  supportEmail?: string;
}): EmailTemplate {
  const { 
    customerName, 
    orderId, 
    itemCount, 
    totalUsd, 
    frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com', 
    language = 'fr',
    supportWhatsapp = '243973141627',
    supportEmail = 'nkadimisha@afrishop-usa.com',
  } = params;
  
  const formatWhatsappDisplay = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('243')) {
      return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    }
    return `+${cleaned}`;
  };
  const whatsappDisplay = formatWhatsappDisplay(supportWhatsapp);
  const whatsappLink = supportWhatsapp.replace(/\D/g, '');
  const firstName = customerName.split(' ')[0] || customerName;

  const content: Record<AssistanceEmailLanguage, {
    subject: string;
    greeting: string;
    intro: string;
    help: string;
    orderLabel: string;
    itemsLabel: string;
    contactLabel: string;
    appInstruction: string;
    pasteLinkTitle: string;
    pasteLinkBody: string;
    pasteLinkCta: string;
  }> = {
    en: {
      subject: `🛒 ${firstName}, need help completing your order?`,
      greeting: `Hello ${firstName},`,
      intro: `We noticed you started an order on AfriShop but haven't completed it yet.`,
      help: `Did you run into any issues or have questions? Our team is here to help!`,
      orderLabel: `Your order:`,
      itemsLabel: `item(s)`,
      contactLabel: `Contact us:`,
      appInstruction: `Open the <strong>AfriShop</strong> app on your phone to complete your order.`,
      pasteLinkTitle: `🔗 Can't find what you're looking for?`,
      pasteLinkBody: `Visit our Paste Any Link tool — choose any US store (Amazon, Walmart, Temu, SHEIN…), copy the product link and paste it to get the full price including shipping to your city.`,
      pasteLinkCta: `Paste a Link Now`,
    },
    fr: {
      subject: `🛒 ${firstName}, avez-vous besoin d'aide?`,
      greeting: `Bonjour ${firstName},`,
      intro: `Nous avons remarqué que vous avez commencé une commande sur AfriShop mais ne l'avez pas encore finalisée.`,
      help: `Avez-vous rencontré des difficultés ou avez-vous des questions? Notre équipe est là pour vous aider !`,
      orderLabel: `Votre commande:`,
      itemsLabel: `article(s)`,
      contactLabel: `Contactez-nous:`,
      appInstruction: `Ouvrez l'application <strong>AfriShop</strong> sur votre téléphone pour finaliser votre commande.`,
      pasteLinkTitle: `🔗 Vous ne trouvez pas ce que vous cherchez?`,
      pasteLinkBody: `Visitez notre outil "Coller un lien" — choisissez un magasin américain (Amazon, Walmart, Temu, SHEIN…), copiez le lien du produit et collez-le pour obtenir le prix complet avec la livraison jusqu'à votre ville.`,
      pasteLinkCta: `Coller un lien maintenant`,
    },
    sw: {
      subject: `🛒 ${firstName}, unahitaji msaada kukamilisha oda yako?`,
      greeting: `Habari ${firstName},`,
      intro: `Tumeona ulianza oda kwenye AfriShop lakini bado hujakamilisha.`,
      help: `Je, umekumbana na matatizo yoyote au una maswali? Timu yetu iko hapa kukusaidia!`,
      orderLabel: `Oda yako:`,
      itemsLabel: `bidhaa`,
      contactLabel: `Wasiliana nasi:`,
      appInstruction: `Fungua programu ya <strong>AfriShop</strong> kwenye simu yako ili ukamilishe oda yako.`,
      pasteLinkTitle: `🔗 Hupati unachotafuta?`,
      pasteLinkBody: `Tembelea zana yetu ya "Bandika Kiungo" — chagua duka lolote la Marekani (Amazon, Walmart, Temu, SHEIN…), nakili kiungo na ubandike ili kupata bei kamili pamoja na usafirishaji.`,
      pasteLinkCta: `Bandika Kiungo Sasa`,
    },
    ln: {
      subject: `🛒 ${firstName}, osengeli lisalisi pona kosilisa commande na yo?`,
      greeting: `Mbote ${firstName},`,
      intro: `Tomonaki obandaki commande na AfriShop kasi osilisaki yango te.`,
      help: `Ozali na mikakatano to mituna? Équipe na biso ezali awa pona kosalisa yo!`,
      orderLabel: `Commande na yo:`,
      itemsLabel: `biloko`,
      contactLabel: `Benga biso:`,
      appInstruction: `Fungolá application <strong>AfriShop</strong> na téléphone na yo pona kosilisa commande na yo.`,
      pasteLinkTitle: `🔗 Ozali kozwa te oyo ozali koluka?`,
      pasteLinkBody: `Kende na outil "Coller un lien" — poná magazin ya Amerika (Amazon, Walmart, Temu, SHEIN…), kopya lien ya produit mpe koller yango pona kozwa ntalo mobimba na livraison.`,
      pasteLinkCta: `Koller lien sikoyo`,
    },
    en_sw: {
      subject: `🛒 ${firstName}, need help? / Unahitaji msaada?`,
      greeting: `Hello / Habari ${firstName},`,
      intro: `We noticed you started an order on AfriShop but haven't completed it yet. / Tumeona ulianza oda kwenye AfriShop lakini bado hujakamilisha.`,
      help: `Did you run into any issues? Our team is here to help! / Je, umekumbana na matatizo? Timu yetu iko hapa kukusaidia!`,
      orderLabel: `Your order / Oda yako:`,
      itemsLabel: `item(s) / bidhaa`,
      contactLabel: `Contact us / Wasiliana nasi:`,
      appInstruction: `Open the <strong>AfriShop</strong> app on your phone to complete your order. / Fungua programu ya <strong>AfriShop</strong> kwenye simu yako ili ukamilishe oda yako.`,
      pasteLinkTitle: `🔗 Can't find what you're looking for? / Hupati unachotafuta?`,
      pasteLinkBody: `Visit our Paste Any Link tool — choose any US store, paste the product link to get the full price. / Tembelea zana yetu ya "Bandika Kiungo" ili kupata bei kamili.`,
      pasteLinkCta: `Paste a Link / Bandika Kiungo`,
    },
  };

  const c = content[language] || content.fr;

  const buildSection = (lang: AssistanceEmailLanguage) => {
    const t = content[lang];
    return `
      <div>
        <p style="font-size: 18px; margin-bottom: 15px;"><strong>${t.greeting}</strong></p>
        <p>${t.intro}</p>
        <p>${t.help}</p>
        
        <div style="background: #eff6ff; padding: 15px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>${t.orderLabel}</strong></p>
          <p style="margin: 5px 0;">• ${itemCount} ${t.itemsLabel} • Total: $${totalUsd.toFixed(2)} USD</p>
        </div>

        <p><strong>${t.contactLabel}</strong></p>
        <p style="margin: 5px 0;">📱 WhatsApp: <a href="https://wa.me/${whatsappLink}" style="color: #2563eb;">${whatsappDisplay}</a></p>
        <p style="margin: 5px 0;">📧 Email: <a href="mailto:${supportEmail}" style="color: #2563eb;">${supportEmail}</a></p>
        
        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: center;">
          <p style="margin: 0; font-size: 16px;">
            📲 ${t.appInstruction}
          </p>
        </div>
      </div>
    `;
  };

  let bodyContent: string;
  if (language === 'en_sw') {
    bodyContent = `
      ${buildSection('en')}
      <hr style="margin: 30px 0; border: none; border-top: 2px solid #e5e7eb;" />
      ${buildSection('sw')}
    `;
  } else {
    bodyContent = buildSection(language);
  }

  return {
    subject: c.subject,
    html: `
      <div style="max-width: 600px; margin: 0 auto; ${baseStyles}">
        <div style="${headerStyle}">
          <h1 style="color: white; margin: 0;">🤝 We're Here to Help!</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${bodyContent}
        </div>
        <div style="${footerStyle}">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p>
        </div>
      </div>
    `,
  };
}
