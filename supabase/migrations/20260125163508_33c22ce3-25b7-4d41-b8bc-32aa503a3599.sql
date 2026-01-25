-- Add explicit UPDATE blocking policy for audit log integrity
-- Audit logs must be immutable (INSERT-only, no UPDATE or DELETE)

CREATE POLICY "No one can update audit logs"
ON admin_audit_logs
FOR UPDATE
USING (false);