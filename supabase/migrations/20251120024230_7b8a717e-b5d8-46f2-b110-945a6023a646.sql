-- First, drop the triggers that depend on the function
DROP TRIGGER IF EXISTS update_sessions_updated_at ON public.sessions;
DROP TRIGGER IF EXISTS update_user_submissions_updated_at ON public.user_submissions;

-- Now update the function with proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Recreate the triggers
CREATE TRIGGER update_sessions_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_submissions_updated_at
BEFORE UPDATE ON public.user_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update generate_project_code function with proper search_path
CREATE OR REPLACE FUNCTION public.generate_project_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    code TEXT;
    exists BOOLEAN;
BEGIN
    LOOP
        code := 'PC-' || EXTRACT(YEAR FROM now())::TEXT || '-' || 
                upper(substring(md5(random()::text) from 1 for 4));
        
        SELECT EXISTS(SELECT 1 FROM public.user_submissions WHERE project_code = code) INTO exists;
        
        IF NOT exists THEN
            RETURN code;
        END IF;
    END LOOP;
END;
$$;

-- Add RLS policies for admin_users table
CREATE POLICY "Only admins can view admin users" ON public.admin_users FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);
CREATE POLICY "Only admins can insert admin users" ON public.admin_users FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);
CREATE POLICY "Only admins can delete admin users" ON public.admin_users FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);