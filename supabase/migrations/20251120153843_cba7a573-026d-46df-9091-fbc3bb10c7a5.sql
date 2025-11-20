-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view own submissions by project code" ON public.user_submissions;

-- Create admin-only SELECT policy
CREATE POLICY "Only admins can view all submissions"
ON public.user_submissions
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Create a secure function for users to search their own submission by project code
CREATE OR REPLACE FUNCTION public.search_submission_by_code(search_code TEXT)
RETURNS TABLE (
  id UUID,
  project_code TEXT,
  project_title TEXT,
  submission_status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    project_code,
    project_title,
    submission_status::TEXT,
    created_at
  FROM public.user_submissions
  WHERE project_code = UPPER(search_code)
  LIMIT 1;
$$;