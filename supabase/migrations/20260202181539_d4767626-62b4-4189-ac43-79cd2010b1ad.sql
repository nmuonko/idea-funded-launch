-- Fix support_tickets RLS to restrict admin access to assigned tickets only
-- Super admins can view all, regular admins only see assigned/unassigned tickets

-- First, create a helper function to check if user can view all tickets (super_admin)
CREATE OR REPLACE FUNCTION public.can_view_all_tickets(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role = 'admin'
      AND admin_role = 'super_admin'
  );
$$;

-- Create helper function to check if admin can access a specific ticket
CREATE OR REPLACE FUNCTION public.can_access_ticket(p_user_id uuid, p_ticket_assigned_to uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- Super admin can access all
    public.can_view_all_tickets(p_user_id)
    OR
    -- Regular admin with can_view_tickets can access assigned to them or unassigned
    (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = p_user_id AND role = 'admin'
      )
      AND EXISTS (
        SELECT 1 FROM public.admin_user_permissions
        WHERE user_id = p_user_id AND can_view_tickets = true
      )
      AND (
        p_ticket_assigned_to IS NULL  -- Unassigned tickets
        OR p_ticket_assigned_to = p_user_id  -- Assigned to this admin
      )
    );
$$;

-- Drop existing admin policies on support_tickets
DROP POLICY IF EXISTS "Admins can view all tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Admins can update all tickets" ON public.support_tickets;

-- Create new restrictive policies for support_tickets
-- Super admins can view all tickets
CREATE POLICY "Super admins can view all tickets"
ON public.support_tickets
FOR SELECT
TO authenticated
USING (public.can_view_all_tickets(auth.uid()));

-- Admins can view tickets assigned to them or unassigned
CREATE POLICY "Admins can view assigned or unassigned tickets"
ON public.support_tickets
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin')
  AND EXISTS (
    SELECT 1 FROM public.admin_user_permissions
    WHERE user_id = auth.uid() AND can_view_tickets = true
  )
  AND (assigned_to IS NULL OR assigned_to = auth.uid())
);

-- Super admins can update all tickets  
CREATE POLICY "Super admins can update all tickets"
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (public.can_view_all_tickets(auth.uid()));

-- Admins can update tickets assigned to them or unassigned
CREATE POLICY "Admins can update assigned or unassigned tickets"
ON public.support_tickets
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin')
  AND EXISTS (
    SELECT 1 FROM public.admin_user_permissions
    WHERE user_id = auth.uid() AND can_view_tickets = true
  )
  AND (assigned_to IS NULL OR assigned_to = auth.uid())
);

-- Fix ticket_messages RLS as well
DROP POLICY IF EXISTS "Admins can view all ticket messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "Admins can add messages to any ticket" ON public.ticket_messages;

-- Super admins can view all messages
CREATE POLICY "Super admins can view all ticket messages"
ON public.ticket_messages
FOR SELECT
TO authenticated
USING (public.can_view_all_tickets(auth.uid()));

-- Admins can view messages on tickets assigned to them
CREATE POLICY "Admins can view messages on accessible tickets"
ON public.ticket_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets st
    WHERE st.id = ticket_messages.ticket_id
    AND public.can_access_ticket(auth.uid(), st.assigned_to)
  )
);

-- Super admins can add messages to any ticket
CREATE POLICY "Super admins can add messages to any ticket"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (public.can_view_all_tickets(auth.uid()));

-- Admins can add messages to accessible tickets
CREATE POLICY "Admins can add messages to accessible tickets"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.support_tickets st
    WHERE st.id = ticket_messages.ticket_id
    AND public.can_access_ticket(auth.uid(), st.assigned_to)
  )
);