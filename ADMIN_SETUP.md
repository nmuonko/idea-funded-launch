# Admin User Setup Guide

## Quick Setup - Promote Your First Admin

To promote a user to admin, you need to add a record to the `user_roles` table.

### Option 1: Via Backend Database (Recommended)

1. Click the **Cloud** tab in Lovable
2. Go to **Database** → **Tables** → **user_roles**
3. Click **Insert row**
4. Fill in:
   - `user_id`: Copy your user ID from the `auth.users` table (find your email first)
   - `role`: Select `admin`
5. Click **Save**

### Option 2: Via SQL Query

Run this SQL in the Backend → Database → SQL Editor:

```sql
-- Replace 'your-email@example.com' with the email address you want to promote
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'your-email@example.com'
ON CONFLICT (user_id, role) DO NOTHING;
```

### Verify Admin Access

1. Log out and log back in (or refresh the page)
2. Navigate to `/admin`
3. You should now see the admin dashboard

## Admin User Management

Once you're an admin, you can use the Admin Dashboard to:
- View all orders
- Manage order statuses
- Update system settings (fees, exchange rates)
- Promote other users to admin (via the upcoming Admin User Management page)

## Security Notes

- Admin roles are stored in a separate `user_roles` table for security
- The `has_role()` security definer function checks permissions server-side
- Row Level Security (RLS) policies protect all admin operations
- Never store admin status in localStorage or client-side storage
