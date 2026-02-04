

# Move "Mark Paid" to Order Details & Add Print Label Button

## Summary
Replace the "Mark Paid" button in the Orders table with a "Print Label" button that generates a printable PDF shipping label. Move the "Mark Paid" functionality to inside the Order Details drawer.

---

## Changes Overview

### 1. Orders Table (src/pages/admin/Orders.tsx)

**Current state:**
- "Details" button + "Mark Paid" button (for DRAFT/PENDING_PAYMENT orders)

**New state:**
- "Details" button + "Print Label" button (same conditions)

The "Print Label" button will generate a PDF-style printable label containing:
- Customer's full name
- Home address (from profiles: address_line1, address_line2, city, state_province, postal_code, country)
- Items purchased with quantities

### 2. Order Details Drawer (src/components/admin/OrderDetailsDrawer.tsx)

**Add "Mark as Paid" button** in the Admin Actions section, visible only for DRAFT or PENDING_PAYMENT orders that haven't been paid yet.

### 3. Fetch Additional Address Fields

Update the Orders query to include address fields from profiles:
- address_line1, address_line2, city, state_province, postal_code, country, address

---

## Technical Details

### File: src/pages/admin/Orders.tsx

**Query Update (lines ~111):**
Add address fields to the profiles select:
```typescript
profiles(user_id, name, full_name, email, phone, address_line1, address_line2, city, state_province, postal_code, country, address)
```

**New Function - handlePrintLabel:**
```typescript
const handlePrintLabel = (order: any) => {
  const profile = order.profiles;
  const customerName = profile?.name || profile?.full_name || 'Customer';
  
  // Build address from available fields
  const addressParts = [
    profile?.address_line1,
    profile?.address_line2,
    profile?.city,
    profile?.state_province,
    profile?.postal_code,
    profile?.country
  ].filter(Boolean);
  
  const address = addressParts.length > 0 
    ? addressParts.join(', ') 
    : (profile?.address || order.shipping_city || 'N/A');

  const items = order.order_items || [];
  
  // Generate printable HTML label
  const labelHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shipping Label - ${formatOrderId(order.id, customerName)}</title>
      <style>
        @page { size: 4in 6in; margin: 0.25in; }
        body { font-family: Arial, sans-serif; padding: 20px; }
        .label-container { border: 2px solid #000; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 15px; }
        .logo { font-size: 24px; font-weight: bold; }
        .section { margin-bottom: 15px; }
        .section-title { font-weight: bold; font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 5px; }
        .customer-name { font-size: 20px; font-weight: bold; }
        .address { font-size: 14px; line-height: 1.4; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .items-table th, .items-table td { border: 1px solid #ccc; padding: 5px; text-align: left; }
        .items-table th { background: #f0f0f0; }
        .order-id { font-size: 10px; color: #666; margin-top: 15px; text-align: center; }
        @media print { body { margin: 0; } .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="label-container">
        <div class="header">
          <div class="logo">📦 AfriShop</div>
          <div style="font-size: 12px; margin-top: 5px;">Shipping Label</div>
        </div>
        
        <div class="section">
          <div class="section-title">Ship To:</div>
          <div class="customer-name">${customerName}</div>
          <div class="address">${address}</div>
        </div>
        
        <div class="section">
          <div class="section-title">Items (${items.length}):</div>
          <table class="items-table">
            <thead>
              <tr><th>Product</th><th>Qty</th></tr>
            </thead>
            <tbody>
              ${items.map((item: any) => `
                <tr>
                  <td>${item.title || 'Product'}</td>
                  <td>${item.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <div class="order-id">
          Order: ${formatOrderId(order.id, customerName)}
        </div>
      </div>
      
      <div class="no-print" style="margin-top: 20px; text-align: center;">
        <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">
          🖨️ Print Label
        </button>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(labelHtml);
    printWindow.document.close();
  }
};
```

**Replace Mark Paid Button (lines 989-998):**
Change from:
```tsx
{(order.status === 'PENDING_PAYMENT' || order.status === 'DRAFT') && !order.payment_verified_at && (
  <Button ... onClick={() => handleMarkAsPaid(order.id)} ...>
    <CreditCard ... /> Mark Paid
  </Button>
)}
```

To:
```tsx
{(order.status === 'PENDING_PAYMENT' || order.status === 'DRAFT') && !order.payment_verified_at && (
  <Button
    variant="default"
    size="sm"
    onClick={() => handlePrintLabel(order)}
    className="bg-purple-600 hover:bg-purple-700"
  >
    <Printer className="h-4 w-4 mr-2" />
    Print Label
  </Button>
)}
```

**Add Printer import:**
```typescript
import { ..., Printer } from 'lucide-react';
```

---

### File: src/components/admin/OrderDetailsDrawer.tsx

**Add Mark as Paid button** in the Admin Actions section (after the Need Help button):

```tsx
{/* Mark as Paid button for unpaid orders */}
{(order.status === 'DRAFT' || order.status === 'PENDING_PAYMENT') && !order.payment_verified_at && (
  <Button
    onClick={handleMarkAsPaid}
    disabled={markingAsPaid}
    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
  >
    {markingAsPaid ? (
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
    ) : (
      <CreditCard className="h-4 w-4 mr-2" />
    )}
    Mark as Paid
  </Button>
)}
```

**Add state and handler:**
```typescript
const [markingAsPaid, setMarkingAsPaid] = useState(false);

const handleMarkAsPaid = async () => {
  if (!orderId) return;
  
  setMarkingAsPaid(true);
  try {
    const { error } = await supabase.functions.invoke('verify-maisha-payment', {
      body: {
        orderId,
        manualOverride: true,
        notes: 'Manual verification by admin - callback issue workaround'
      }
    });

    if (error) throw error;

    toast({
      title: 'Payment Verified',
      description: 'Order marked as paid successfully',
    });

    loadOrderDetails();
    onUpdate();
  } catch (error: any) {
    toast({
      title: 'Error',
      description: error.message,
      variant: 'destructive',
    });
  } finally {
    setMarkingAsPaid(false);
  }
};
```

**Add CreditCard import:**
```typescript
import { ..., CreditCard } from 'lucide-react';
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/admin/Orders.tsx` | Add `handlePrintLabel` function, replace "Mark Paid" with "Print Label" button, update profiles query, add Printer icon import |
| `src/components/admin/OrderDetailsDrawer.tsx` | Add `handleMarkAsPaid` function and button in Admin Actions section, add state, add CreditCard import |

---

## Visual Summary

**Orders Table - Before:**
```
[Details] [Mark Paid] [...]
```

**Orders Table - After:**
```
[Details] [Print Label] [...]
```

**Order Details Drawer - New button added:**
```
Admin Actions
─────────────
[Need Help? Send Assistance Email]  (for DRAFT/PENDING_PAYMENT)
[Mark as Paid]                       (for DRAFT/PENDING_PAYMENT, unpaid)
[Add Note]  [Send Email]
[Issue Refund]
```

---

## Label Preview

The generated shipping label will look like:

```
┌─────────────────────────────────────┐
│         📦 AfriShop                 │
│        Shipping Label               │
├─────────────────────────────────────┤
│ SHIP TO:                            │
│ Nathan Kadimisha                    │
│ 123 Main St, Apt 4B                 │
│ Lubumbashi, Haut-Katanga            │
│ Democratic Republic of Congo        │
├─────────────────────────────────────┤
│ ITEMS (2):                          │
│ ┌─────────────────────────┬───────┐ │
│ │ Product                 │ Qty   │ │
│ ├─────────────────────────┼───────┤ │
│ │ Apple iPhone 15 Pro     │ 1     │ │
│ │ Samsung Galaxy Watch    │ 2     │ │
│ └─────────────────────────┴───────┘ │
├─────────────────────────────────────┤
│     Order: #ASH-NATHAN-1234         │
└─────────────────────────────────────┘
         [🖨️ Print Label]
```

