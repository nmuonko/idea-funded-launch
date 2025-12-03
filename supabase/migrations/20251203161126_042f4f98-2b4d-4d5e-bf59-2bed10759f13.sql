-- Add email_sent field to track delivery status
ALTER TABLE public.admin_invitations 
ADD COLUMN IF NOT EXISTS email_sent boolean DEFAULT false;

-- Add invite_url field to store the invitation link
ALTER TABLE public.admin_invitations 
ADD COLUMN IF NOT EXISTS invite_url text;