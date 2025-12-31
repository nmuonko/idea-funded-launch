-- Create price_confirmations table for admin price review workflow
CREATE TABLE public.price_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cart_item_id uuid NULL,
  product_url text NOT NULL,
  store text NOT NULL,
  proposed_price numeric NOT NULL CHECK (proposed_price > 0),
  proposed_currency text NOT NULL CHECK (proposed_currency IN ('USD', 'CDF')),
  extracted_price numeric NULL,
  extracted_currency text NULL,
  extraction_source text NULL CHECK (extraction_source IS NULL OR extraction_source IN ('structured', 'dom', 'manual')),
  extraction_confidence numeric NULL CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'ADJUSTED', 'REJECTED')),
  admin_price numeric NULL,
  admin_currency text NULL CHECK (admin_currency IS NULL OR admin_currency IN ('USD', 'CDF')),
  admin_note text NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id),
  reviewed_at timestamptz NULL
);

-- Create indexes for efficient queries
CREATE INDEX idx_price_confirmations_user_status ON public.price_confirmations (user_id, status);
CREATE INDEX idx_price_confirmations_status_created ON public.price_confirmations (status, created_at DESC);

-- Create trigger for auto-updating updated_at
CREATE TRIGGER update_price_confirmations_updated_at
  BEFORE UPDATE ON public.price_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Enable Row Level Security
ALTER TABLE public.price_confirmations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can insert their own requests
CREATE POLICY "Users can insert own price confirmations"
  ON public.price_confirmations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can select their own requests
CREATE POLICY "Users can view own price confirmations"
  ON public.price_confirmations
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Admins can select all rows
CREATE POLICY "Admins can view all price confirmations"
  ON public.price_confirmations
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policy: Admins can update all rows
CREATE POLICY "Admins can update price confirmations"
  ON public.price_confirmations
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Enable realtime for price_confirmations
ALTER PUBLICATION supabase_realtime ADD TABLE public.price_confirmations;