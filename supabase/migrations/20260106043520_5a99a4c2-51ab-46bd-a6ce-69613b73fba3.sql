-- Add missing columns to order_items for price confirmation workflow
ALTER TABLE public.order_items 
  ADD COLUMN IF NOT EXISTS captured_price numeric,
  ADD COLUMN IF NOT EXISTS price_source text DEFAULT 'scraped';

-- Create admin_notifications table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- Enable RLS on admin_notifications
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Admins can view all admin notifications
CREATE POLICY "Admins can view admin notifications"
  ON public.admin_notifications FOR SELECT
  USING (public.is_admin());

-- Admins can update (mark as read)
CREATE POLICY "Admins can update admin notifications"
  ON public.admin_notifications FOR UPDATE
  USING (public.is_admin());

-- Create user_notifications table
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON public.user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created_at ON public.user_notifications(created_at DESC);

-- Enable RLS on user_notifications
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view only their own notifications
CREATE POLICY "Users can view own notifications"
  ON public.user_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update only their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON public.user_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Add comment to clarify price_source values
COMMENT ON COLUMN public.order_items.price_source IS 'Values: scraped, manual_user, admin_confirmed';
COMMENT ON COLUMN public.order_items.price_confirmation_status IS 'Values: APPROVED, PENDING';