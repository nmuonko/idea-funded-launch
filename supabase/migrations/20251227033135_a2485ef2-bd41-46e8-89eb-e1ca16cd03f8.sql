-- =========================================
-- FIX REMAINING CRITICAL SECURITY ISSUES
-- =========================================

-- 1. FIX: admin_invitations - restrict the email-based lookup policy
-- Currently allows users to view invitations by checking their email
-- This could be used to enumerate admin emails
DROP POLICY IF EXISTS "Users can view their own email invitations" ON public.admin_invitations;

CREATE POLICY "Users can accept their own pending invitations"
ON public.admin_invitations
FOR SELECT
USING (
  -- Must be authenticated
  auth.uid() IS NOT NULL
  -- Email must match the authenticated user's email
  AND email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
  -- Must be pending and not expired
  AND status = 'pending'
  AND expires_at > now()
);

-- 2. FIX: knowledge_base_articles - require authentication for viewing
ALTER TABLE public.knowledge_base_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view published articles" ON public.knowledge_base_articles;
DROP POLICY IF EXISTS "Published articles are public" ON public.knowledge_base_articles;

CREATE POLICY "Authenticated users can view published articles"
ON public.knowledge_base_articles
FOR SELECT
USING (auth.uid() IS NOT NULL AND published = true);

-- Keep admin policy
DROP POLICY IF EXISTS "Admins can manage all articles" ON public.knowledge_base_articles;
CREATE POLICY "Admins can manage all articles"
ON public.knowledge_base_articles
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Note: public_settings and safe_user_payments are VIEWS
-- Views inherit RLS from underlying tables (settings and maisha_payments)
-- The underlying tables already have proper RLS