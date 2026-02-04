
# Add Language Selection for "Need Help?" Assistance Email

## Overview
Enhance the "Need Help?" email button on the admin Order Details page to allow selection of the email language. The admin can choose from:
- **English only**
- **French only** 
- **Swahili only**
- **Lingala only**
- **English + Swahili** (combined bilingual)

Currently the email is hardcoded as French + English bilingual. This update will give admins control over which language(s) to use based on the customer's preference.

---

## Implementation Details

### 1. Update Email Template Function
**File:** `supabase/functions/_shared/emailTemplates.ts`

Modify `buildOrderAssistanceEmail()` to accept a `language` parameter and generate content based on the selection:

```typescript
export type AssistanceEmailLanguage = 'en' | 'fr' | 'sw' | 'ln' | 'en_sw';

export function buildOrderAssistanceEmail(params: {
  customerName: string;
  orderId: string;
  itemCount: number;
  totalUsd: number;
  frontendBaseUrl?: string;
  language?: AssistanceEmailLanguage; // NEW parameter
}): EmailTemplate
```

Add translations for all 4 languages:
- **English**: Current English content
- **French**: Current French content  
- **Swahili**: New Swahili translation
- **Lingala**: New Lingala translation
- **English + Swahili**: Combined bilingual format

Example subject lines per language:
| Language | Subject |
|----------|---------|
| English | `🛒 {name}, need help completing your order?` |
| French | `🛒 {name}, avez-vous besoin d'aide?` |
| Swahili | `🛒 {name}, unahitaji msaada kukamilisha oda yako?` |
| Lingala | `🛒 {name}, osengeli lisalisi pona kosilisa commande na yo?` |
| EN + SW | `🛒 {name}, need help? / Unahitaji msaada?` |

---

### 2. Update Edge Function
**File:** `supabase/functions/send-order-assistance-email/index.ts`

Accept new `language` parameter in request body:

```typescript
const { orderId, language = 'fr' } = await req.json();
// Pass language to buildOrderAssistanceEmail
const emailTemplate = buildOrderAssistanceEmail({
  customerName,
  orderId,
  itemCount: itemCount || 0,
  totalUsd: Number(order.total_usd || 0),
  frontendBaseUrl,
  language,
});
```

---

### 3. Update Admin Order Details UI
**File:** `src/pages/admin/OrderDetail.tsx`

Replace the single "Need Help?" button with a dropdown button that allows language selection:

**New state:**
```typescript
const [assistanceLanguage, setAssistanceLanguage] = useState<string>('fr');
const [assistanceMenuOpen, setAssistanceMenuOpen] = useState(false);
```

**UI changes:**
- Replace the current `<Button>` with a `DropdownMenu` component
- Show language options with flags/labels:
  - 🇬🇧 English
  - 🇫🇷 French  
  - 🇹🇿 Swahili (Kiswahili)
  - 🇨🇩 Lingala
  - 🇬🇧+🇹🇿 English + Swahili

**Updated handler:**
```typescript
const handleSendAssistanceEmail = async (language: string) => {
  setSendingAssistanceEmail(true);
  const { data, error } = await supabase.functions.invoke('send-order-assistance-email', {
    body: { orderId: id, language },
  });
  // ... rest of handler
};
```

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/_shared/emailTemplates.ts` | Modify | Add language parameter + translations for SW/LN |
| `supabase/functions/send-order-assistance-email/index.ts` | Modify | Accept language in request body |
| `src/pages/admin/OrderDetail.tsx` | Modify | Replace button with dropdown menu |

---

## Email Content Translations

### Swahili (sw)
> **Habari {jina},**
>
> Tumeona ulianza oda kwenye AfriShop lakini bado hujakamilisha. Je, umekumbana na matatizo yoyote au una maswali?
>
> Timu yetu iko hapa kukusaidia!
>
> **Wasiliana nasi:**
> 📱 WhatsApp: +1 (424) 217-4633
> 📧 Barua pepe: nkadimisha@afrishop-usa.com
>
> [Kamilisha Oda Yangu]

### Lingala (ln)
> **Mbote {nkombo},**
>
> Tomonaki obandaki commande na AfriShop kasi osilisaki yango te. Ozali na mikakatano to mituna?
>
> Équipe na biso ezali awa pona kosalisa yo!
>
> **Benga biso:**
> 📱 WhatsApp: +1 (424) 217-4633
> 📧 Email: nkadimisha@afrishop-usa.com
>
> [Kosilisa Commande Na Ngai]

---

## UI Preview

The "Need Help?" button becomes a dropdown:

```text
┌──────────────────────────────┐
│ ❓ Need Help? ▼              │
├──────────────────────────────┤
│ 🇬🇧 Send in English          │
│ 🇫🇷 Send in French           │
│ 🇹🇿 Send in Swahili          │
│ 🇨🇩 Send in Lingala          │
│ ─────────────────────────    │
│ 🇬🇧+🇹🇿 English + Swahili     │
└──────────────────────────────┘
```

Selecting an option immediately sends the email in that language.

---

## Technical Notes

- Default language is French (`fr`) if not specified (matches primary DRC audience)
- The edge function will validate the language parameter against allowed values
- All sent emails continue to be logged to `customer_email_logs` with the full HTML content
- No database schema changes required
