# Cart Analytics & Customer Intelligence System

This document describes the advanced cart analytics features including value heatmaps, customer lifetime value (LTV) predictions, and intelligent cart merging.

## Features Overview

### 1. Cart Value Heatmap
Visualizes which product categories generate the highest-value abandoned carts to identify optimization opportunities.

**Location**: Admin Dashboard → A/B Test Results (renamed to "Cart Analytics & Recovery")

**Features**:
- Color-coded heatmap (blue → yellow → orange → red based on abandoned cart value)
- Shows total abandoned value, cart count, item count, and average cart value per category
- Categories include: AMAZON, EBAY, WALMART, BESTBUY, CARVANA, CARGURUS, OTHER
- Helps prioritize recovery efforts on high-value categories

**Data Source**: 
- Queries `orders` table for DRAFT and PENDING_PAYMENT status
- Joins with `order_items` to aggregate by `store` (category)
- Real-time updates as carts are created/abandoned

### 2. Customer Lifetime Value (LTV) Prediction
AI-powered prediction system that analyzes customer behavior to predict 12-month lifetime value and provide personalized recommendations.

**Location**: Admin Dashboard → Cart Analytics & Recovery page

**Features**:
- Enter any user ID to analyze their purchase behavior
- AI analyzes:
  - Completed order history
  - Average order value
  - Abandoned cart behavior (count and value)
  - Order frequency patterns
  - Category preferences and spending
- Generates predictions:
  - **Predicted 12-Month LTV** (in USD)
  - **Customer Tier**: Bronze (<$500), Silver ($500-$2000), Gold ($2000-$5000), Platinum (>$5000)
  - **Churn Risk**: Low, Medium, High
  - **Top 3 Personalized Recommendations** to increase LTV

**How It Works**:
1. Backend function `predict-customer-ltv` retrieves user order history
2. Calculates behavioral metrics (spend, frequency, categories, abandonment)
3. Calls Lovable AI Gateway with structured prompt
4. AI model (google/gemini-2.5-flash) analyzes patterns and returns JSON prediction
5. Frontend displays results with visual badges and recommendations

**Edge Function**: `supabase/functions/predict-customer-ltv/index.ts`

**API Endpoint**: 
```
POST /functions/v1/predict-customer-ltv
Body: { "userId": "<uuid>" }
```

**Component**: `src/components/admin/CustomerLTVPanel.tsx`

### 3. Intelligent Cart Merge
Automatically consolidates duplicate items when users add the same product multiple times to their cart.

**How It Works**:
- When a user adds an item via `mobile-add-cart-item`, the system checks for existing items with the same `product_url` in the user's DRAFT order
- If a duplicate is found:
  - Quantities are merged (old quantity + new quantity)
  - Subtotal is recalculated: `base_price_usd * new_quantity`
  - Response includes `"merged": true` flag
- If no duplicate exists, a new item is created normally

**Benefits**:
- Cleaner cart UX (no duplicate product rows)
- Accurate quantity tracking
- Simplified checkout process
- Better cart analytics (correct item counts)

**Implementation**: Updated `supabase/functions/mobile-add-cart-item/index.ts`

**Mobile App Integration**:
```typescript
// When adding item to cart
const response = await fetch('/functions/v1/mobile-add-cart-item', {
  method: 'POST',
  body: JSON.stringify({
    productUrl: 'https://amazon.com/...',
    productPrice: 29.99,
    quantity: 2,
    productTitle: 'Product Name',
    productImageUrl: 'https://...'
  })
});

const result = await response.json();

if (result.merged) {
  // Item was merged with existing cart item
  showToast('Quantity updated in cart');
} else {
  // New item added
  showToast('Added to cart');
}
```

## AI Model Configuration

The LTV prediction system uses **Lovable AI Gateway** with these specifications:

- **Model**: `google/gemini-2.5-flash` (balanced speed and accuracy)
- **API Key**: `LOVABLE_API_KEY` (auto-configured in Supabase secrets)
- **Method**: Structured output via function calling/tool use
- **Fallback**: If rate-limited (429) or out of credits (402), appropriate error messages are returned

**Rate Limits**:
- See workspace usage limits in Settings → Workspace → Usage
- Free tier: Limited requests per month
- Paid plans: Higher limits, can request increases via support@lovable.dev

## Usage Analytics

All three features work together to provide comprehensive cart recovery intelligence:

1. **Heatmap** identifies which product categories need attention
2. **LTV Prediction** prioritizes which customers to focus recovery efforts on (high-value, low-risk customers)
3. **Cart Merge** ensures clean data for accurate analytics and better user experience

## Admin Workflow

**Recommended Process**:
1. Review Cart Value Heatmap to identify high-value abandoned categories
2. Use LTV predictions to segment customers by value tier and risk level
3. Prioritize recovery efforts for:
   - High LTV prediction + High abandoned cart value = Top priority
   - Gold/Platinum tier customers with abandoned carts
   - Low churn risk customers (likely to convert with gentle nudge)
4. Use AI recommendations to personalize recovery emails and offers

## Future Enhancements

Potential additions:
- Automated LTV calculations for all customers (batch processing)
- LTV-based customer segmentation for email campaigns
- Category-specific recovery strategies based on heatmap insights
- Predictive alerts when high-LTV customers abandon carts
- Integration with A/B testing to measure LTV impact of different recovery timing strategies

## Technical Notes

- **Data Privacy**: LTV predictions use aggregated behavioral data, no PII is sent to AI
- **Performance**: Heatmap queries are optimized with indexed queries on order status
- **Scalability**: Cart merge logic runs O(1) on each add-cart operation
- **Real-time**: All analytics components refresh data on page load

## Troubleshooting

**Heatmap shows no data**:
- Ensure there are DRAFT or PENDING_PAYMENT orders in the database
- Check that order_items have valid `store` values

**LTV prediction fails**:
- Verify LOVABLE_API_KEY is configured in Supabase secrets
- Check workspace credit balance (Settings → Workspace → Usage)
- Ensure user ID exists and has at least some order history

**Cart merge not working**:
- Verify product URLs match exactly (case-sensitive, including query params)
- Check mobile-add-cart-item edge function logs for errors
- Ensure user has an active session and authentication token