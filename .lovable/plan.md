

# Add "Need Help?" Email Button to Order Details

## Overview
Add a one-click button to the admin Order Details page that sends a personalized bilingual email (French/English) asking customers if they need assistance completing their order. The email starts with the customer's name for a personalized touch.

---

## Implementation Details

### 1. Add Email Template to `supabase/functions/_shared/emailTemplates.ts`

Create a new function `buildOrderAssistanceEmail()`:

```typescript
export function buildOrderAssistanceEmail(params: {
  customerName: string;
  orderId: string;
  itemCount: number;
  totalUsd: number;
  frontendBaseUrl?: string;
}): EmailTemplate {
  const { customerName, orderId, itemCount, totalUsd, frontendBaseUrl = 'https://afrishop-usa.com' } = params;
  
  return {
    subject: `🛒 ${customerName}, avez-vous besoin d'aide? / Need help completing your order?`,
    html: `
      // Personalized bilingual email starting with customer's name
      // French section: "Bonjour {customerName}," + assistance offer
      // English section: "Hello {customerName}," + assistance offer
      // WhatsApp + Email contact info
      // "Complete Order" CTA button
    `,
  };
}
```

Key features:
- **Personalized subject line**: Starts with customer's name
- **Personalized greeting**: "Bonjour {customerName}," / "Hello {customerName},"
- **Friendly tone**: Mentions they noticed an incomplete order
- **Contact options**: WhatsApp (+1-XXX-XXX-XXXX) and email
- **CTA Button**: "Complete Your Order" linking to order tracking

---

### 2. Create Edge Function `send-order-assistance-email`

**File:** `supabase/functions/send-order-assistance-email/index.ts`

Request body:
```typescript
{ orderId: string }
```

Logic:
1. Validate admin authentication (JWT + `user_roles` check)
2. Fetch order details with profile (name, email)
3. Validate order is in `DRAFT` or `PENDING_PAYMENT` status
4. Build personalized email using `buildOrderAssistanceEmail()`
5. Send via Resend using shared `sendEmail()` utility
6. Log to `customer_email_logs` table
7. Return success/failure response

---

### 3. Update `src/pages/admin/OrderDetail.tsx`

Add new state and handler:

```typescript
const [sendingAssistanceEmail, setSendingAssistanceEmail] = useState(false);

const handleSendAssistanceEmail = async () => {
  setSendingAssistanceEmail(true);
  const { error } = await supabase.functions.invoke('send-order-assistance-email', {
    body: { orderId: id }
  });
  // Toast success/error
  setSendingAssistanceEmail(false);
};
```

Add button in the "Quick Actions" section (around line 466-468):

```tsx
{/* Show for incomplete orders with customer email */}
{(order.status === 'DRAFT' || order.status === 'PENDING_PAYMENT') && order.profiles?.email && (
  <Button
    onClick={handleSendAssistanceEmail}
    disabled={sendingAssistanceEmail}
    size="sm"
    variant="outline"
    className="border-blue-500 text-blue-600 hover:bg-blue-50"
  >
    {sendingAssistanceEmail ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <HelpCircle className="h-4 w-4 mr-2" />}
    Need Help?
  </Button>
)}
```

---

### 4. Update `supabase/config.toml`

Add JWT verification config:
```toml
[functions.send-order-assistance-email]
verify_jwt = false
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/_shared/emailTemplates.ts` | Modify | Add `buildOrderAssistanceEmail()` template |
| `supabase/functions/send-order-assistance-email/index.ts` | Create | New edge function |
| `src/pages/admin/OrderDetail.tsx` | Modify | Add button + handler + import `HelpCircle` |

---

## Email Content Preview

**Subject:** 
`🛒 Jean, avez-vous besoin d'aide? / Need help completing your order?`

**Body (personalized, bilingual):**

> **Bonjour Jean,**
>
> Nous avons remarqué que vous avez commencé une commande sur AfriShop mais ne l'avez pas encore finalisée. Avez-vous rencontré des difficultés ou avez-vous des questions?
>
> Notre équipe est là pour vous aider ! N'hésitez pas à nous contacter:
> - 📱 WhatsApp: +1-XXX-XXX-XXXX
> - 📧 Email: nkadimisha@afrishop-usa.com
>
> [Finaliser Ma Commande] ← CTA button
>
> ---
>
> **Hello Jean,**
>
> We noticed you started an order on AfriShop but haven't completed it yet. Did you run into any issues or have questions?
>
> Our team is here to help! Feel free to reach out:
> - 📱 WhatsApp: +1-XXX-XXX-XXXX
> - 📧 Email: nkadimisha@afrishop-usa.com
>
> [Complete My Order] ← CTA button

---

## Button Visibility Rules

The "Need Help?" button will only appear when:
1. Order status is `DRAFT` or `PENDING_PAYMENT`
2. Customer has an email address on their profile

---

## Security

- Admin-only access enforced via JWT validation
- Checks `user_roles` table for `admin` role
- All emails logged to `customer_email_logs` for audit trail

