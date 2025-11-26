CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: notification_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_channel AS ENUM (
    'email',
    'whatsapp'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'winner',
    'non_winner',
    'info'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'airtel_money',
    'orange_money',
    'm_pesa',
    'afrimoney'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'paid',
    'failed'
);


--
-- Name: session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status AS ENUM (
    'open',
    'closed',
    'results_published'
);


--
-- Name: submission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.submission_status AS ENUM (
    'pending',
    'under_review',
    'selected',
    'not_selected'
);


--
-- Name: auto_generate_project_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_generate_project_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: ensure_single_active_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_single_active_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE public.sessions 
    SET is_active = false 
    WHERE id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_project_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_project_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: get_active_session(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_session() RETURNS TABLE(id uuid, name text, start_date timestamp with time zone, deadline_datetime timestamp with time zone, target_applicants integer, desired_max_participants integer, current_participant_count integer, review_progress integer, status text, is_active boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT 
    id,
    name,
    start_date,
    deadline_datetime,
    target_applicants,
    desired_max_participants,
    current_participant_count,
    review_progress,
    status::text,
    is_active
  FROM public.sessions
  WHERE is_active = true
  LIMIT 1;
$$;


--
-- Name: get_public_session_info(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_session_info() RETURNS TABLE(id uuid, name text, start_date timestamp with time zone, announcement_date timestamp with time zone, status text, desired_max_participants integer, current_participant_count integer, application_fee numeric, currency text, enable_waitlist boolean, waitlist_count integer, review_progress integer, payment_instructions text, target_applicants integer, deadline_datetime timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT 
    id,
    name,
    start_date,
    announcement_date,
    status::TEXT,
    desired_max_participants,
    current_participant_count,
    application_fee,
    currency,
    enable_waitlist,
    waitlist_count,
    review_progress,
    payment_instructions,
    target_applicants,
    deadline_datetime
  FROM public.sessions
  WHERE status IN ('open', 'closed', 'results_published')
  ORDER BY created_at DESC;
$$;


--
-- Name: get_session_progress(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_session_progress(session_uuid uuid) RETURNS TABLE(session_name text, target_applicants integer, current_count bigint, progress_percentage numeric, deadline_datetime timestamp with time zone, status text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT 
    s.name,
    s.target_applicants,
    COUNT(us.id) FILTER (WHERE us.payment_status = 'paid' AND us.is_draft = false) as current_count,
    CASE 
      WHEN s.target_applicants > 0 THEN 
        ROUND((COUNT(us.id) FILTER (WHERE us.payment_status = 'paid' AND us.is_draft = false)::NUMERIC / s.target_applicants::NUMERIC) * 100, 1)
      ELSE 0
    END as progress_percentage,
    s.deadline_datetime,
    s.status::TEXT
  FROM public.sessions s
  LEFT JOIN public.user_submissions us ON us.session_id = s.id
  WHERE s.id = session_uuid
  GROUP BY s.id, s.name, s.target_applicants, s.deadline_datetime, s.status;
$$;


--
-- Name: handle_new_user_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id, 
    display_name, 
    full_name, 
    date_of_birth, 
    city
  )
  VALUES (
    NEW.id, 
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    (NEW.raw_user_meta_data->>'date_of_birth')::DATE,
    NEW.raw_user_meta_data->>'city'
  );
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


--
-- Name: search_submission_by_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_submission_by_code(search_code text) RETURNS TABLE(id uuid, project_code text, project_title text, submission_status text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: sync_admin_user_to_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_admin_user_to_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  target_user_id uuid;
BEGIN
  -- Handle INSERT: add admin role to user_roles
  IF TG_OP = 'INSERT' THEN
    -- Find the user_id from auth.users by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = NEW.email
    LIMIT 1;
    
    IF target_user_id IS NOT NULL THEN
      -- Insert the admin role if it doesn't exist
      INSERT INTO public.user_roles (user_id, role)
      VALUES (target_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE: remove admin role from user_roles
  IF TG_OP = 'DELETE' THEN
    -- Find the user_id from auth.users by email
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = OLD.email
    LIMIT 1;
    
    IF target_user_id IS NOT NULL THEN
      -- Delete the admin role
      DELETE FROM public.user_roles
      WHERE user_id = target_user_id
      AND role = 'admin';
    END IF;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;


--
-- Name: update_payments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payments_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: validate_payment_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_payment_amount() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
  IF NEW.payment_amount IS NOT NULL AND NEW.payment_amount < 20 THEN
    RAISE EXCEPTION 'Minimum payment amount is $20. Received: $%', NEW.payment_amount;
  END IF;
  
  IF NEW.amount_due IS NOT NULL AND NEW.amount_due < 20 THEN
    RAISE EXCEPTION 'Minimum amount due is $20. Received: $%', NEW.amount_due;
  END IF;
  
  RETURN NEW;
END;
$_$;


SET default_table_access_method = heap;

--
-- Name: admin_ai_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_ai_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_email text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    action_description text NOT NULL,
    details_json jsonb,
    success boolean DEFAULT true NOT NULL,
    error_message text
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    whatsapp_number text,
    subject text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    key text NOT NULL,
    value jsonb DEFAULT 'false'::jsonb NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    channel public.notification_channel NOT NULL,
    type public.notification_type NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'maishapay'::text NOT NULL,
    status text NOT NULL,
    description text,
    transaction_ref_id text,
    operator_ref_id text,
    amount numeric,
    currency text DEFAULT 'USD'::text,
    submission_id uuid,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    full_name text,
    date_of_birth date,
    city text
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    desired_max_participants integer DEFAULT 100 NOT NULL,
    current_participant_count integer DEFAULT 0 NOT NULL,
    announcement_date timestamp with time zone,
    status public.session_status DEFAULT 'open'::public.session_status NOT NULL,
    review_progress integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    application_fee numeric DEFAULT 0,
    currency text DEFAULT 'USD'::text,
    airtel_money_number text,
    m_pesa_number text,
    orange_money_number text,
    afrimoney_number text,
    payment_instructions text,
    enable_waitlist boolean DEFAULT false,
    waitlist_count integer DEFAULT 0,
    target_applicants integer DEFAULT 500,
    deadline_datetime timestamp with time zone,
    is_active boolean DEFAULT false,
    CONSTRAINT sessions_review_progress_check CHECK (((review_progress >= 0) AND (review_progress <= 100)))
);


--
-- Name: site_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: theme_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.theme_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    primary_color text DEFAULT '#0F172A'::text NOT NULL,
    secondary_color text DEFAULT '#6366F1'::text NOT NULL,
    accent_color text DEFAULT '#FACC15'::text NOT NULL,
    hero_background_style text DEFAULT 'gradient'::text NOT NULL,
    button_style text,
    typography_preset text DEFAULT 'modern'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    full_name text NOT NULL,
    whatsapp_number text NOT NULL,
    email text NOT NULL,
    city_province text NOT NULL,
    project_title text NOT NULL,
    project_description text NOT NULL,
    estimated_monthly_revenue numeric(10,2) NOT NULL,
    time_until_profit text NOT NULL,
    feasibility_explanation text NOT NULL,
    funding_needed integer NOT NULL,
    will_hire boolean DEFAULT false NOT NULL,
    number_of_hires integer,
    agreements_confirmed boolean DEFAULT false NOT NULL,
    project_code text,
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    payment_method public.payment_method,
    submission_status public.submission_status DEFAULT 'pending'::public.submission_status NOT NULL,
    selection_timestamp timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country text,
    project_type text,
    payment_phone_number text,
    payment_amount numeric,
    payment_reference text,
    language_detected text,
    project_description_raw text,
    category text,
    ai_summary text,
    ai_strengths text,
    ai_risks text,
    ai_impact_score integer,
    ai_feasibility_score integer,
    ai_overall_score integer,
    ai_feedback_short text,
    ai_translation_en text,
    ai_translation_fr text,
    ai_translation_sw text,
    ai_translation_ln text,
    fraud_flags text,
    is_suspected_fraud boolean DEFAULT false,
    is_possible_duplicate boolean DEFAULT false,
    duplicate_of_submission_id uuid,
    ai_last_reviewed_at timestamp with time zone,
    status text DEFAULT 'submitted'::text,
    submission_type text DEFAULT 'text'::text,
    is_draft boolean DEFAULT true,
    preferred_language text,
    amount_due numeric DEFAULT 20,
    project_title_voice_audio_url text,
    project_description_voice_audio_url text,
    problem_voice_audio_url text,
    audience_voice_audio_url text,
    feasibility_voice_audio_url text,
    budget_voice_audio_url text,
    impact_voice_audio_url text,
    why_voice_audio_url text,
    project_title_voice_text text,
    project_description_voice_text text,
    problem_voice_text text,
    audience_voice_text text,
    feasibility_voice_text text,
    budget_voice_text text,
    impact_voice_text text,
    why_voice_text text,
    problem_to_solve text,
    target_audience text,
    feasibility_explanation_extended text,
    budget_details text,
    expected_impact text,
    why_selected text,
    payment_provider text DEFAULT 'maishapay'::text,
    payment_currency text DEFAULT 'USD'::text,
    maishapay_reference text,
    maishapay_transaction_id text,
    maishapay_raw_response jsonb,
    confirmation_id text,
    submitted_at timestamp with time zone,
    payment_ref_id text,
    payment_operator_id text,
    CONSTRAINT user_submissions_ai_feasibility_score_check CHECK (((ai_feasibility_score >= 1) AND (ai_feasibility_score <= 10))),
    CONSTRAINT user_submissions_ai_impact_score_check CHECK (((ai_impact_score >= 1) AND (ai_impact_score <= 10))),
    CONSTRAINT user_submissions_ai_overall_score_check CHECK (((ai_overall_score >= 1) AND (ai_overall_score <= 10))),
    CONSTRAINT user_submissions_funding_needed_check CHECK ((funding_needed = ANY (ARRAY[500, 1000, 2000]))),
    CONSTRAINT user_submissions_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'shortlisted'::text, 'winner'::text, 'not_selected'::text]))),
    CONSTRAINT user_submissions_submission_type_check CHECK ((submission_type = ANY (ARRAY['text'::text, 'voice'::text])))
);


--
-- Name: winners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.winners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    winner_name text NOT NULL,
    project_name text NOT NULL,
    country text NOT NULL,
    award_amount numeric NOT NULL,
    year integer NOT NULL,
    testimonial_text text,
    short_quote text,
    image_url text,
    display_order integer DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_ai_logs admin_ai_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_ai_logs
    ADD CONSTRAINT admin_ai_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: site_content site_content_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_content
    ADD CONSTRAINT site_content_key_key UNIQUE (key);


--
-- Name: site_content site_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_content
    ADD CONSTRAINT site_content_pkey PRIMARY KEY (id);


--
-- Name: theme_settings theme_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme_settings
    ADD CONSTRAINT theme_settings_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: user_submissions user_submissions_confirmation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_submissions
    ADD CONSTRAINT user_submissions_confirmation_id_key UNIQUE (confirmation_id);


--
-- Name: user_submissions user_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_submissions
    ADD CONSTRAINT user_submissions_pkey PRIMARY KEY (id);


--
-- Name: user_submissions user_submissions_project_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_submissions
    ADD CONSTRAINT user_submissions_project_code_key UNIQUE (project_code);


--
-- Name: winners winners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.winners
    ADD CONSTRAINT winners_pkey PRIMARY KEY (id);


--
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);


--
-- Name: idx_chat_messages_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session_id ON public.chat_messages USING btree (session_id);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_submission_id ON public.payments USING btree (submission_id);


--
-- Name: idx_payments_transaction_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_transaction_ref ON public.payments USING btree (transaction_ref_id);


--
-- Name: idx_submissions_duplicate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_duplicate ON public.user_submissions USING btree (duplicate_of_submission_id) WHERE (duplicate_of_submission_id IS NOT NULL);


--
-- Name: idx_submissions_fraud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_fraud ON public.user_submissions USING btree (is_suspected_fraud, is_possible_duplicate);


--
-- Name: idx_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_status ON public.user_submissions USING btree (status);


--
-- Name: idx_user_submissions_confirmation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_confirmation_id ON public.user_submissions USING btree (confirmation_id);


--
-- Name: idx_user_submissions_draft_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_draft_paid ON public.user_submissions USING btree (is_draft, payment_status);


--
-- Name: idx_user_submissions_maishapay_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_maishapay_reference ON public.user_submissions USING btree (maishapay_reference);


--
-- Name: idx_user_submissions_maishapay_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_maishapay_transaction_id ON public.user_submissions USING btree (maishapay_transaction_id);


--
-- Name: idx_user_submissions_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_payment_status ON public.user_submissions USING btree (payment_status);


--
-- Name: idx_user_submissions_project_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_project_code ON public.user_submissions USING btree (project_code);


--
-- Name: idx_user_submissions_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_session_id ON public.user_submissions USING btree (session_id);


--
-- Name: idx_user_submissions_submission_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_submission_status ON public.user_submissions USING btree (submission_status);


--
-- Name: idx_user_submissions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_submissions_type ON public.user_submissions USING btree (submission_type);


--
-- Name: sessions ensure_single_active_session_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ensure_single_active_session_trigger BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.ensure_single_active_session();


--
-- Name: payments payments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_payments_updated_at();


--
-- Name: admin_users sync_admin_users_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_admin_users_trigger AFTER INSERT OR DELETE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.sync_admin_user_to_roles();


--
-- Name: user_submissions trigger_auto_generate_project_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_generate_project_code BEFORE UPDATE ON public.user_submissions FOR EACH ROW EXECUTE FUNCTION public.auto_generate_project_code();


--
-- Name: feature_flags update_feature_flags_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_feature_flags_updated_at BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sessions update_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: site_content update_site_content_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_site_content_updated_at BEFORE UPDATE ON public.site_content FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: theme_settings update_theme_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_theme_settings_updated_at BEFORE UPDATE ON public.theme_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_submissions update_user_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_submissions_updated_at BEFORE UPDATE ON public.user_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: winners update_winners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_winners_updated_at BEFORE UPDATE ON public.winners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_submissions validate_payment_amount_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_payment_amount_trigger BEFORE INSERT OR UPDATE ON public.user_submissions FOR EACH ROW EXECUTE FUNCTION public.validate_payment_amount();


--
-- Name: notification_logs notification_logs_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.user_submissions(id) ON DELETE CASCADE;


--
-- Name: payments payments_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.user_submissions(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_submissions user_submissions_duplicate_of_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_submissions
    ADD CONSTRAINT user_submissions_duplicate_of_submission_id_fkey FOREIGN KEY (duplicate_of_submission_id) REFERENCES public.user_submissions(id);


--
-- Name: user_submissions user_submissions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_submissions
    ADD CONSTRAINT user_submissions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: winners winners_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.winners
    ADD CONSTRAINT winners_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: payments Admins can view all payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all payments" ON public.payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: chat_messages Anyone can insert chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert chat messages" ON public.chat_messages FOR INSERT WITH CHECK (true);


--
-- Name: contact_messages Anyone can insert contact messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert contact messages" ON public.contact_messages FOR INSERT WITH CHECK (true);


--
-- Name: user_submissions Anyone can insert submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert submissions" ON public.user_submissions FOR INSERT WITH CHECK (true);


--
-- Name: site_content Anyone can read site content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read site content" ON public.site_content FOR SELECT USING (true);


--
-- Name: user_submissions Anyone can search by project code; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can search by project code" ON public.user_submissions FOR SELECT USING ((project_code IS NOT NULL));


--
-- Name: sessions Anyone can view active sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view active sessions" ON public.sessions FOR SELECT USING ((status = ANY (ARRAY['open'::public.session_status, 'closed'::public.session_status, 'results_published'::public.session_status])));


--
-- Name: feature_flags Anyone can view feature flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view feature flags" ON public.feature_flags FOR SELECT USING (true);


--
-- Name: winners Anyone can view published winners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view published winners" ON public.winners FOR SELECT USING ((is_published = true));


--
-- Name: user_submissions Anyone can view recent submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view recent submissions" ON public.user_submissions FOR SELECT USING ((created_at > (now() - '00:05:00'::interval)));


--
-- Name: chat_messages Anyone can view their session messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view their session messages" ON public.chat_messages FOR SELECT USING (true);


--
-- Name: theme_settings Anyone can view theme settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view theme settings" ON public.theme_settings FOR SELECT USING (true);


--
-- Name: admin_users Authenticated users can check admin status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can check admin status" ON public.admin_users FOR SELECT TO authenticated USING (true);


--
-- Name: admin_users Only admins can delete admin users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can delete admin users" ON public.admin_users FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Only admins can delete roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can delete roles" ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: site_content Only admins can delete site content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can delete site content" ON public.site_content FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: admin_ai_logs Only admins can insert AI logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert AI logs" ON public.admin_ai_logs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: admin_users Only admins can insert admin users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert admin users" ON public.admin_users FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: notification_logs Only admins can insert notification logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert notification logs" ON public.notification_logs FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Only admins can insert roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert roles" ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: sessions Only admins can insert sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert sessions" ON public.sessions FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: site_content Only admins can insert site content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can insert site content" ON public.site_content FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: feature_flags Only admins can manage feature flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can manage feature flags" ON public.feature_flags FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: theme_settings Only admins can manage theme settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can manage theme settings" ON public.theme_settings USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: winners Only admins can manage winners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can manage winners" ON public.winners USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: feature_flags Only admins can update feature flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update feature flags" ON public.feature_flags FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Only admins can update roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update roles" ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: sessions Only admins can update sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update sessions" ON public.sessions FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: site_content Only admins can update site content; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update site content" ON public.site_content FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: user_submissions Only admins can update submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can update submissions" ON public.user_submissions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: admin_ai_logs Only admins can view AI logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view AI logs" ON public.admin_ai_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: user_submissions Only admins can view all submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view all submissions" ON public.user_submissions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: contact_messages Only admins can view contact messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view contact messages" ON public.contact_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'admin'::public.app_role)))));


--
-- Name: notification_logs Only admins can view notification logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view notification logs" ON public.notification_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments Service role can manage payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage payments" ON public.payments USING ((auth.role() = 'service_role'::text));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: admin_ai_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_ai_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: site_content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.theme_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: winners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.winners ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


