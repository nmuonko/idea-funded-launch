-- =============================================
-- A) EMAIL VERIFICATION ENFORCEMENT
-- =============================================

-- Create function to check if current user has verified email
CREATE OR REPLACE FUNCTION public.is_email_verified()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT email_confirmed_at IS NOT NULL 
     FROM auth.users 
     WHERE id = auth.uid()),
    false
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.is_email_verified() TO authenticated;

-- Update orders INSERT policy to require email verification
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
CREATE POLICY "Users can insert their own orders" 
ON public.orders 
FOR INSERT 
TO authenticated
WITH CHECK (
  auth.uid() = user_id 
  AND public.is_email_verified() = true
);

-- Add policy for checkout_sessions INSERT (only verified users can create)
DROP POLICY IF EXISTS "Users can create their own checkout sessions" ON public.checkout_sessions;
CREATE POLICY "Users can create their own checkout sessions"
ON public.checkout_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.is_email_verified() = true
);

-- Add policy for payment_attempts INSERT (only verified users can create)
DROP POLICY IF EXISTS "Users can create payment attempts" ON public.payment_attempts;
CREATE POLICY "Users can create payment attempts"
ON public.payment_attempts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.is_email_verified() = true
);

-- =============================================
-- B) STORE VISIT FREQUENCY TRACKING
-- =============================================

-- Create store_visit_counts table
CREATE TABLE IF NOT EXISTS public.store_visit_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  store_id text NOT NULL,
  visit_count integer NOT NULL DEFAULT 1,
  last_visited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index for upsert behavior
-- Uses a computed visitor_key approach for the unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_visit_counts_unique 
ON public.store_visit_counts (
  COALESCE(user_id::text, ''), 
  device_id, 
  store_id
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_store_visit_counts_user_id 
ON public.store_visit_counts(user_id) 
WHERE user_id IS NOT NULL;

-- Create index for device lookups
CREATE INDEX IF NOT EXISTS idx_store_visit_counts_device_id 
ON public.store_visit_counts(device_id);

-- Enable RLS
ALTER TABLE public.store_visit_counts ENABLE ROW LEVEL SECURITY;

-- RLS policies for store_visit_counts
CREATE POLICY "Users can view their own visit counts"
ON public.store_visit_counts
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all visit counts"
ON public.store_visit_counts
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Inserts/updates handled via edge function with service role
CREATE POLICY "Service role can manage visit counts"
ON public.store_visit_counts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================
-- C) RECENTLY VIEWED ITEMS (PER USER/DEVICE)
-- =============================================

-- Create recently_viewed_items table
CREATE TABLE IF NOT EXISTS public.recently_viewed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  store_id text NOT NULL,
  product_url text NOT NULL,
  title text,
  image_url text,
  view_count integer NOT NULL DEFAULT 1,
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index for upsert behavior
CREATE UNIQUE INDEX IF NOT EXISTS idx_recently_viewed_unique 
ON public.recently_viewed_items (
  COALESCE(user_id::text, ''), 
  device_id, 
  product_url
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_recently_viewed_user_id 
ON public.recently_viewed_items(user_id) 
WHERE user_id IS NOT NULL;

-- Create index for device lookups
CREATE INDEX IF NOT EXISTS idx_recently_viewed_device_id 
ON public.recently_viewed_items(device_id);

-- Create index for sorting by last viewed
CREATE INDEX IF NOT EXISTS idx_recently_viewed_last_viewed 
ON public.recently_viewed_items(last_viewed_at DESC);

-- Enable RLS
ALTER TABLE public.recently_viewed_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for recently_viewed_items
CREATE POLICY "Users can view their own recently viewed items"
ON public.recently_viewed_items
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all recently viewed items"
ON public.recently_viewed_items
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Service role handles inserts/updates for both auth and guest
CREATE POLICY "Service role can manage recently viewed items"
ON public.recently_viewed_items
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =============================================
-- D) UPDATED_AT TRIGGERS
-- =============================================

-- Trigger for store_visit_counts
DROP TRIGGER IF EXISTS update_store_visit_counts_updated_at ON public.store_visit_counts;
CREATE TRIGGER update_store_visit_counts_updated_at
  BEFORE UPDATE ON public.store_visit_counts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Trigger for recently_viewed_items
DROP TRIGGER IF EXISTS update_recently_viewed_items_updated_at ON public.recently_viewed_items;
CREATE TRIGGER update_recently_viewed_items_updated_at
  BEFORE UPDATE ON public.recently_viewed_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- E) HELPER FUNCTION FOR UPSERT OPERATIONS
-- =============================================

-- Function to upsert store visit count
CREATE OR REPLACE FUNCTION public.upsert_store_visit(
  p_user_id uuid,
  p_device_id text,
  p_store_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
  v_id uuid;
  v_count integer;
BEGIN
  INSERT INTO public.store_visit_counts (user_id, device_id, store_id, visit_count, last_visited_at)
  VALUES (p_user_id, p_device_id, p_store_id, 1, now())
  ON CONFLICT (COALESCE(user_id::text, ''), device_id, store_id)
  DO UPDATE SET
    visit_count = store_visit_counts.visit_count + 1,
    last_visited_at = now(),
    updated_at = now()
  RETURNING id, visit_count INTO v_id, v_count;
  
  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'visit_count', v_count
  );
END;
$$;

-- Function to upsert recently viewed item
CREATE OR REPLACE FUNCTION public.upsert_recently_viewed(
  p_user_id uuid,
  p_device_id text,
  p_store_id text,
  p_product_url text,
  p_title text DEFAULT NULL,
  p_image_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
  v_id uuid;
  v_count integer;
BEGIN
  INSERT INTO public.recently_viewed_items (user_id, device_id, store_id, product_url, title, image_url, view_count, last_viewed_at)
  VALUES (p_user_id, p_device_id, p_store_id, p_product_url, p_title, p_image_url, 1, now())
  ON CONFLICT (COALESCE(user_id::text, ''), device_id, product_url)
  DO UPDATE SET
    view_count = recently_viewed_items.view_count + 1,
    last_viewed_at = now(),
    title = COALESCE(EXCLUDED.title, recently_viewed_items.title),
    image_url = COALESCE(EXCLUDED.image_url, recently_viewed_items.image_url),
    store_id = EXCLUDED.store_id,
    updated_at = now()
  RETURNING id, view_count INTO v_id, v_count;
  
  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'view_count', v_count
  );
END;
$$;

-- Function to get recently viewed items for a user/device
CREATE OR REPLACE FUNCTION public.get_recently_viewed(
  p_user_id uuid,
  p_device_id text,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  store_id text,
  product_url text,
  title text,
  image_url text,
  view_count integer,
  last_viewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.store_id,
    r.product_url,
    r.title,
    r.image_url,
    r.view_count,
    r.last_viewed_at
  FROM public.recently_viewed_items r
  WHERE 
    (p_user_id IS NOT NULL AND r.user_id = p_user_id)
    OR (r.device_id = p_device_id AND (r.user_id IS NULL OR r.user_id = p_user_id))
  ORDER BY r.last_viewed_at DESC
  LIMIT p_limit;
END;
$$;