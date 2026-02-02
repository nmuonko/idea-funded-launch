-- Fix bank_transfer_proofs storage bucket RLS policies
-- Current policy is overly permissive - only checks bucket_id without role verification

-- Drop the permissive policy that allows any authenticated user access
DROP POLICY IF EXISTS "Service role only for bank transfer proofs upload" ON storage.objects;

-- Create admin-restricted SELECT policy
CREATE POLICY "Admins can view bank transfer proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'bank_transfer_proofs' AND has_role(auth.uid(), 'admin'::app_role));

-- Create admin-restricted DELETE policy  
CREATE POLICY "Admins can delete bank transfer proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'bank_transfer_proofs' AND has_role(auth.uid(), 'admin'::app_role));

-- Note: Service role INSERT operations (from edge functions) bypass RLS automatically
-- so no special INSERT policy is needed for the upload-manual-transfer-proof edge function