import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SubmitRequest {
  reference: string;
  name?: string;
  contact?: string;
  file_base64: string;
  file_name: string;
  file_type: string;
}

/**
 * submit-bank-transfer-proof Edge Function
 * 
 * PUBLIC endpoint - no auth required.
 * Uploads proof file to storage and creates submission record.
 * Uses service role to bypass RLS.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const body: SubmitRequest = await req.json();
    const { reference, name, contact, file_base64, file_name, file_type } = body;

    // Validate required fields
    if (!reference || reference.trim().length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!file_base64 || !file_name) {
      return new Response(
        JSON.stringify({ ok: false, error: 'File is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file_type)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid file type. Allowed: images, PDF' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 file
    let fileData: Uint8Array;
    try {
      fileData = decode(file_base64);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid file data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check file size (max 10MB)
    if (fileData.length > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ ok: false, error: 'File too large (max 10MB)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate unique file path
    const timestamp = Date.now();
    const sanitizedRef = reference.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
    const ext = file_name.split('.').pop() || 'bin';
    const filePath = `${sanitizedRef}/${timestamp}_${crypto.randomUUID()}.${ext}`;

    console.log('[submit-bank-transfer-proof] Uploading file:', filePath);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('bank_transfer_proofs')
      .upload(filePath, fileData, {
        contentType: file_type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[submit-bank-transfer-proof] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to upload file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create submission record
    const { data: submission, error: insertError } = await supabase
      .from('bank_transfer_submissions')
      .insert({
        reference: reference.trim(),
        name: name?.trim() || null,
        contact: contact?.trim() || null,
        file_path: filePath,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[submit-bank-transfer-proof] Insert error:', insertError);
      // Try to delete the uploaded file
      await supabase.storage.from('bank_transfer_proofs').remove([filePath]);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to create submission' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[submit-bank-transfer-proof] Submission created:', submission.id);

    return new Response(
      JSON.stringify({ ok: true, submission_id: submission.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[submit-bank-transfer-proof] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});