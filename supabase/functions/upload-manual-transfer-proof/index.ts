import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

serve(async (req: Request): Promise<Response> => {
  console.log("[upload-manual-transfer-proof] Request received");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse multipart form data or JSON with base64
    const contentType = req.headers.get("content-type") || "";
    
    let uploadToken: string;
    let fileData: Uint8Array;
    let originalFilename: string;
    let mimeType: string;

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart form data
      const formData = await req.formData();
      uploadToken = formData.get("upload_token") as string;
      const file = formData.get("file") as File;

      if (!file) {
        return new Response(
          JSON.stringify({ ok: false, error: "No file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      originalFilename = file.name;
      mimeType = file.type;
      fileData = new Uint8Array(await file.arrayBuffer());
    } else {
      // Handle JSON with base64
      const body = await req.json();
      uploadToken = body.upload_token;
      
      if (!body.file_base64 || !body.filename || !body.mime_type) {
        return new Response(
          JSON.stringify({ ok: false, error: "Missing file data" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Remove data URL prefix if present
      let base64Data = body.file_base64;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }

      originalFilename = body.filename;
      mimeType = body.mime_type;
      
      // Decode base64
      const binaryString = atob(base64Data);
      fileData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        fileData[i] = binaryString.charCodeAt(i);
      }
    }

    // Validate token
    if (!uploadToken || typeof uploadToken !== "string" || uploadToken.length < 32) {
      console.log("[upload-manual-transfer-proof] Invalid token");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token", code: "INVALID_TOKEN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate file size
    if (fileData.length > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ ok: false, error: "File too large. Maximum size is 10MB." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate mime type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!allowedTypes.includes(mimeType)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF, PDF" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[upload-manual-transfer-proof] Looking up session for token:", uploadToken.slice(0, 8) + "...");

    // Find the session
    const { data: session, error: sessionError } = await supabase
      .from("manual_transfer_sessions")
      .select("*")
      .eq("upload_token", uploadToken)
      .maybeSingle();

    if (sessionError || !session) {
      console.log("[upload-manual-transfer-proof] Session not found");
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found", code: "NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      console.log("[upload-manual-transfer-proof] Session expired");
      return new Response(
        JSON.stringify({ ok: false, error: "Session expired", code: "EXPIRED" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate file path
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const ext = originalFilename.split(".").pop() || "bin";
    const filePath = `manual-transfer/${session.reference}/${timestamp}_${randomSuffix}.${ext}`;

    console.log("[upload-manual-transfer-proof] Uploading to:", filePath);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("payment-proofs")
      .upload(filePath, fileData, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload-manual-transfer-proof] Upload error:", uploadError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to upload file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create proof record
    const { data: proof, error: proofError } = await supabase
      .from("manual_transfer_proofs")
      .insert({
        session_id: session.id,
        order_id: session.order_id,
        reference: session.reference,
        file_path: filePath,
        original_filename: originalFilename,
        mime_type: mimeType,
        size_bytes: fileData.length,
        status: "pending",
      })
      .select()
      .single();

    if (proofError) {
      console.error("[upload-manual-transfer-proof] Proof record error:", proofError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to record proof" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update session status to submitted
    await supabase
      .from("manual_transfer_sessions")
      .update({ status: "submitted" })
      .eq("id", session.id);

    console.log("[upload-manual-transfer-proof] Proof uploaded successfully:", proof.id);

    return new Response(
      JSON.stringify({
        ok: true,
        proof_id: proof.id,
        message: "Proof uploaded successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[upload-manual-transfer-proof] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
