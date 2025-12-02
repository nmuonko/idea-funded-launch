# Admin AI Assistant Documentation

## Overview

The Admin AI Assistant is a permission-aware chatbot embedded in the AfriShop Admin Portal. It allows administrators to query business data using natural language while respecting role-based access controls.

## Features

- **Natural Language Queries**: Ask questions like "What's my revenue this month?" or "How many urgent tickets are open?"
- **Permission-Aware Responses**: The AI only accesses and reports on data the admin has permission to view
- **Conversation History**: Maintains context across multiple messages in a session
- **Floating Interface**: Accessible from any admin page via a floating button

## Architecture

### Backend Edge Function

**Location**: `supabase/functions/admin-ai-assistant/index.ts`

The edge function:
1. Authenticates the admin user via JWT
2. Retrieves their role from `user_roles` table
3. Fetches only permitted data based on role
4. Constructs a context-aware prompt for the AI
5. Calls Lovable AI Gateway (gemini-2.5-flash)
6. Logs the interaction to `ai_assistant_logs` table

### Frontend Component

**Location**: `src/components/admin/AIAdminAssistant.tsx`

Features:
- Floating button interface
- Expandable chat panel
- Suggested queries for new users
- Loading states and error handling

## Role-Based Permissions

### Super Admin
- **Full Access**: orders, payments, users, analytics, support, carts, settings

### Finance
- **Access**: payments, analytics
- **Restricted**: orders, users, support, carts, settings

### Operations
- **Access**: orders, carts, shipping
- **Restricted**: payments, users, analytics, support, settings

### Support
- **Access**: support, orders (view only)
- **Restricted**: payments, users, analytics, carts, settings

## Data Available to AI

Based on permissions, the AI receives:

| Data Type | Fields | Roles |
|-----------|--------|-------|
| Orders | Count, status breakdown, revenue | super_admin, operations, support |
| Payments | Transaction counts, values | super_admin, finance |
| Carts | Active count, total value, high-value count | super_admin, operations |
| Support | Open tickets, urgent count | super_admin, support |
| Analytics | Monthly metrics, trends | super_admin, finance |

## Example Queries

### Revenue Questions (Finance/Super Admin)
- "What is my total revenue this month?"
- "How does this week compare to last week?"
- "What's the average order value?"

### Order Questions (Operations/Super Admin)
- "How many orders are pending?"
- "List unfulfilled orders"
- "What's the most common store?"

### Support Questions (Support/Super Admin)
- "How many urgent tickets are open?"
- "What's the average response time?"
- "Any escalated tickets?"

### Cart Questions (Operations/Super Admin)
- "How many abandoned carts over $500?"
- "What's the total value of active carts?"
- "Show high-value carts from Carvana"

## Security Considerations

1. **Authentication**: All requests require valid JWT token
2. **Authorization**: Role checked before data access
3. **Data Filtering**: Only permitted data included in AI context
4. **Audit Logging**: All queries logged with user ID and role
5. **No Direct DB Access**: AI cannot execute queries directly

## Limitations

1. The AI cannot:
   - Modify data
   - Access user credentials
   - Query data outside its permission scope
   - Provide real-time updates (snapshot-based)

2. Rate Limits:
   - Subject to Lovable AI rate limits
   - 429 errors displayed to user with retry message

3. Context Window:
   - Last 10 messages retained for context
   - Complex queries may need rephrasing

## Logging

All interactions are logged to `ai_assistant_logs`:
- `user_id`: The admin who made the query
- `action_type`: 'ADMIN_QUERY'
- `prompt`: The user's question
- `response`: The AI's answer
- `metadata`: Role and permissions at time of query

## Troubleshooting

### "I can't access that data"
- User's role doesn't have permission for requested data
- Check `user_roles` table for correct `admin_role`

### "Rate limit exceeded"
- Too many requests in short period
- Wait and retry, or contact support for limit increase

### AI gives incorrect data
- Data is snapshot-based, refresh for latest
- Complex calculations may need verification
- Check `ai_assistant_logs` for query context
