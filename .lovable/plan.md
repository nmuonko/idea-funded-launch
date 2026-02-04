

# Replace "Finaliser Ma Commande" Button with App Return Instructions

## Problem
The current "Finaliser Ma Commande" button in the assistance email links to the web (`https://afrishop-usa.com/orders`), but users primarily use the mobile app. Deep linking directly from email is not feasible because:

1. **Email clients block custom URL schemes** - Gmail, Outlook, and most email clients strip or block `afrishop://` links for security
2. **Universal Links not configured** - The app doesn't have Apple Universal Links (`apple-app-site-association`) or Android App Links (`assetlinks.json`) set up, which would allow `https://` links to open the app

## Solution
Remove the button and replace it with clear, multilingual instructions telling users to open the AfriShop app and complete their order there.

---

## Changes

### File: `supabase/functions/_shared/emailTemplates.ts`

**Remove the CTA button** and **add app return instructions** in each language:

| Language | Current Button | New Instruction |
|----------|---------------|-----------------|
| English | `Complete My Order` | "Open the **AfriShop app** on your phone to complete your order." |
| French | `Finaliser Ma Commande` | "Ouvrez l'application **AfriShop** sur votre téléphone pour finaliser votre commande." |
| Swahili | `Kamilisha Oda Yangu` | "Fungua programu ya **AfriShop** kwenye simu yako ili ukamilishe oda yako." |
| Lingala | `Kosilisa Commande Na Ngai` | "Fungolá application **AfriShop** na téléphone na yo pona kosilisa commande na yo." |
| EN + SW | Combined | Both English and Swahili instructions |

### Visual Change

**Before:**
```
Contact us:
📱 WhatsApp: +243 973 141 627
📧 Email: nkadimisha@afrishop-usa.com

[Finaliser Ma Commande]  ← Blue button linking to web
```

**After:**
```
Contact us:
📱 WhatsApp: +243 973 141 627
📧 Email: nkadimisha@afrishop-usa.com

📲 Open the AfriShop app on your phone to complete your order.
```

---

## Technical Details

### Changes to `buildOrderAssistanceEmail` function

1. **Add new translation key** `appInstruction` for each language
2. **Remove the button HTML** (lines 583-587)
3. **Add instruction paragraph** with mobile phone emoji (📲) and bold app name

```typescript
// Add to content translations
en: {
  // ...existing keys...
  appInstruction: `Open the <strong>AfriShop</strong> app on your phone to complete your order.`,
},
fr: {
  // ...existing keys...
  appInstruction: `Ouvrez l'application <strong>AfriShop</strong> sur votre téléphone pour finaliser votre commande.`,
},
sw: {
  // ...existing keys...
  appInstruction: `Fungua programu ya <strong>AfriShop</strong> kwenye simu yako ili ukamilishe oda yako.`,
},
ln: {
  // ...existing keys...
  appInstruction: `Fungolá application <strong>AfriShop</strong> na téléphone na yo pona kosilisa commande na yo.`,
},
en_sw: {
  // ...existing keys...
  appInstruction: `Open the <strong>AfriShop</strong> app on your phone to complete your order. / Fungua programu ya <strong>AfriShop</strong> kwenye simu yako ili ukamilishe oda yako.`,
}
```

### Updated HTML template section

```html
<!-- REMOVE this button section -->
<p style="margin-top: 20px;">
  <a href="${frontendBaseUrl}/orders" style="${buttonStyle}">
    ${t.ctaText}
  </a>
</p>

<!-- ADD this instruction instead -->
<div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: center;">
  <p style="margin: 0; font-size: 16px;">
    📲 ${t.appInstruction}
  </p>
</div>
```

---

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/_shared/emailTemplates.ts` | Remove button, add app instructions in all languages |

---

## Outcome

- The email no longer has a clickable button that takes users to the web
- Users see a clear, highlighted instruction box telling them to open the AfriShop app
- Instructions appear in the customer's preferred language
- The yellow/amber background makes the instruction visually prominent

