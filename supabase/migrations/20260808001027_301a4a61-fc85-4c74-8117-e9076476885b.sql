CREATE OR REPLACE FUNCTION public.guard_admin_invitation_self_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins may manage invitations freely
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Non-admin (invitee self-acceptance): only status/accepted_at may change
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.email_sent IS DISTINCT FROM OLD.email_sent
     OR NEW.invite_url IS DISTINCT FROM OLD.invite_url
  THEN
    RAISE EXCEPTION 'Only status and accepted_at may be modified when accepting an invitation';
  END IF;

  IF NEW.status <> 'accepted' THEN
    RAISE EXCEPTION 'Invitation status may only be set to accepted';
  END IF;

  IF OLD.expires_at < now() THEN
    RAISE EXCEPTION 'Invitation has expired';
  END IF;

  NEW.accepted_at := COALESCE(NEW.accepted_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_admin_invitation_self_accept ON public.admin_invitations;
CREATE TRIGGER guard_admin_invitation_self_accept
  BEFORE UPDATE ON public.admin_invitations
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_invitation_self_accept();

DROP POLICY IF EXISTS users_can_accept_own_invitation ON public.admin_invitations;
CREATE POLICY users_can_accept_own_invitation
  ON public.admin_invitations FOR UPDATE
  TO authenticated
  USING (
    email = ((SELECT users.email FROM auth.users WHERE users.id = auth.uid()))::text
    AND status = 'pending'
    AND expires_at > now()
  )
  WITH CHECK (
    email = ((SELECT users.email FROM auth.users WHERE users.id = auth.uid()))::text
    AND status = 'accepted'
  );