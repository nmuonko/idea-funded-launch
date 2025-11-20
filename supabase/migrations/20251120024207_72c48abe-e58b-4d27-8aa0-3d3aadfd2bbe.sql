-- Create enum types
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed');
CREATE TYPE public.session_status AS ENUM ('open', 'closed', 'results_published');
CREATE TYPE public.submission_status AS ENUM ('pending', 'under_review', 'selected', 'not_selected');
CREATE TYPE public.payment_method AS ENUM ('airtel_money', 'orange_money', 'm_pesa', 'afrimoney');
CREATE TYPE public.notification_channel AS ENUM ('email', 'whatsapp');
CREATE TYPE public.notification_type AS ENUM ('winner', 'non_winner', 'info');

-- Sessions table
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    desired_max_participants INTEGER NOT NULL DEFAULT 100,
    current_participant_count INTEGER NOT NULL DEFAULT 0,
    announcement_date TIMESTAMP WITH TIME ZONE,
    status session_status NOT NULL DEFAULT 'open',
    review_progress INTEGER NOT NULL DEFAULT 0 CHECK (review_progress >= 0 AND review_progress <= 100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- User submissions table
CREATE TABLE public.user_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
    full_name TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL,
    email TEXT NOT NULL,
    city_province TEXT NOT NULL,
    project_title TEXT NOT NULL,
    project_description TEXT NOT NULL,
    estimated_monthly_revenue DECIMAL(10, 2) NOT NULL,
    time_until_profit TEXT NOT NULL,
    feasibility_explanation TEXT NOT NULL,
    funding_needed INTEGER NOT NULL CHECK (funding_needed IN (500, 1000, 2000)),
    will_hire BOOLEAN NOT NULL DEFAULT false,
    number_of_hires INTEGER,
    agreements_confirmed BOOLEAN NOT NULL DEFAULT false,
    project_code TEXT UNIQUE,
    payment_status payment_status NOT NULL DEFAULT 'pending',
    payment_method payment_method,
    submission_status submission_status NOT NULL DEFAULT 'pending',
    selection_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Contact messages table
CREATE TABLE public.contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    whatsapp_number TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Notification logs table
CREATE TABLE public.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID REFERENCES public.user_submissions(id) ON DELETE CASCADE NOT NULL,
    channel notification_channel NOT NULL,
    type notification_type NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    status TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Admin users table for authentication
CREATE TABLE public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sessions (public read, admin write)
CREATE POLICY "Anyone can view sessions" ON public.sessions FOR SELECT USING (true);
CREATE POLICY "Only admins can insert sessions" ON public.sessions FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);
CREATE POLICY "Only admins can update sessions" ON public.sessions FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);

-- RLS Policies for user_submissions (public insert when paying, admin full access)
CREATE POLICY "Anyone can insert submissions" ON public.user_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own submissions by project code" ON public.user_submissions FOR SELECT USING (true);
CREATE POLICY "Only admins can update submissions" ON public.user_submissions FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);

-- RLS Policies for contact_messages (public insert, admin read)
CREATE POLICY "Anyone can insert contact messages" ON public.contact_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Only admins can view contact messages" ON public.contact_messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);

-- RLS Policies for notification_logs (admin only)
CREATE POLICY "Only admins can view notification logs" ON public.notification_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);
CREATE POLICY "Only admins can insert notification logs" ON public.notification_logs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.jwt() ->> 'email')
);

-- Function to generate project codes
CREATE OR REPLACE FUNCTION public.generate_project_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    code TEXT;
    exists BOOLEAN;
BEGIN
    LOOP
        -- Generate code like PC-2025-AB3F
        code := 'PC-' || EXTRACT(YEAR FROM now())::TEXT || '-' || 
                upper(substring(md5(random()::text) from 1 for 4));
        
        -- Check if code already exists
        SELECT EXISTS(SELECT 1 FROM public.user_submissions WHERE project_code = code) INTO exists;
        
        IF NOT exists THEN
            RETURN code;
        END IF;
    END LOOP;
END;
$$;

-- Trigger to auto-generate project code when payment is confirmed
CREATE OR REPLACE FUNCTION public.auto_generate_project_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') AND NEW.project_code IS NULL THEN
        NEW.project_code := public.generate_project_code();
        NEW.submission_status := 'under_review';
        
        -- Increment session participant count
        UPDATE public.sessions 
        SET current_participant_count = current_participant_count + 1,
            updated_at = now()
        WHERE id = NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_generate_project_code
BEFORE UPDATE ON public.user_submissions
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_project_code();

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_sessions_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_submissions_updated_at
BEFORE UPDATE ON public.user_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial session
INSERT INTO public.sessions (name, desired_max_participants, status, review_progress)
VALUES ('Session 1 - 2025', 100, 'open', 0);