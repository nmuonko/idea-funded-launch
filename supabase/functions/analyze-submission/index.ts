import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple rate limiting using in-memory store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Basic rate limiting by IP
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { submissionId } = await req.json();
    
    // Validate submissionId format (must be UUID)
    if (!submissionId || typeof submissionId !== 'string' || 
        !submissionId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return new Response(
        JSON.stringify({ error: 'Invalid submissionId format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the submission
    const { data: submission, error: fetchError } = await supabase
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      throw new Error(`Failed to fetch submission: ${fetchError?.message}`);
    }

    // Enhanced fraud detection: Check for duplicates in database
    const [
      { data: existingSubmissions },
      { data: duplicateEmails },
      { data: duplicatePhones },
      { data: duplicateFromSameUser }
    ] = await Promise.all([
      supabase
        .from('user_submissions')
        .select('id, project_description, project_title, email, whatsapp_number')
        .neq('id', submissionId),
      supabase
        .from('user_submissions')
        .select('id, email, full_name, project_title')
        .eq('email', submission.email)
        .neq('id', submissionId),
      supabase
        .from('user_submissions')
        .select('id, whatsapp_number, full_name, project_title')
        .eq('whatsapp_number', submission.whatsapp_number)
        .neq('id', submissionId),
      supabase
        .from('user_submissions')
        .select('id, project_description, project_title')
        .eq('email', submission.email)
        .eq('whatsapp_number', submission.whatsapp_number)
        .neq('id', submissionId)
    ]);

    // Check for exact or near-duplicate patterns
    let fraudFlags: string[] = [];
    let isSuspectedFraud = false;
    let isPossibleDuplicate = false;

    if (duplicateEmails && duplicateEmails.length > 0) {
      fraudFlags.push(`Duplicate email found: ${duplicateEmails.length} other submission(s) with same email`);
      isSuspectedFraud = true;
    }

    if (duplicatePhones && duplicatePhones.length > 0) {
      fraudFlags.push(`Duplicate phone number: ${duplicatePhones.length} other submission(s) with same WhatsApp number`);
      isSuspectedFraud = true;
    }

    if (duplicateFromSameUser && duplicateFromSameUser.length > 0) {
      fraudFlags.push(`Multiple submissions detected: ${duplicateFromSameUser.length} submission(s) from same email + phone combination`);
      isPossibleDuplicate = true;
    }

    const projectDescription = submission.project_description;

    // Call OpenAI for comprehensive analysis
    const analysisPrompt = `You are an expert evaluator for AfriFund, a program that provides funding to African entrepreneurs and projects. Analyze the following project submission and provide a comprehensive evaluation in JSON format.

Project Title: ${submission.project_title}
Applicant: ${submission.full_name}
Country: ${submission.country}
Project Description: ${projectDescription}

Provide your analysis in the following JSON structure:
{
  "language_detected": "detected language code (en, fr, sw, ln, etc.)",
  "category": "project category (agriculture, fintech, retail, health, education, manufacturing, services, etc.)",
  "ai_summary": "3-5 sentence neutral, judge-friendly summary in English",
  "ai_strengths": "• Bullet point 1\\n• Bullet point 2\\n• Bullet point 3",
  "ai_risks": "• Risk 1\\n• Risk 2\\n• Risk 3",
  "ai_impact_score": number from 1-10,
  "ai_feasibility_score": number from 1-10,
  "ai_overall_score": number from 1-10,
  "ai_feedback_short": "1-2 paragraph message explaining how the applicant could improve their project for future rounds. Use simple, friendly, encouraging language.",
  "ai_translation_en": "English translation of the description",
  "ai_translation_fr": "French translation of the description",
  "ai_translation_sw": "Swahili translation of the description",
  "ai_translation_ln": "Lingala translation of the description"
}

Scoring criteria:
- ai_impact_score: Impact on community, job creation, social value (1-10)
- ai_feasibility_score: Realistic, executable, clear plan (1-10)
- ai_overall_score: Overall potential - use your judgment, not just an average (1-10)`;

    const analysisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert project evaluator. Always respond with valid JSON only.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      }),
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const analysisData = await analysisResponse.json();
    const analysis = JSON.parse(analysisData.choices[0].message.content);

    // Enhanced AI-based fraud detection with similarity scoring
    const fraudPrompt = `You are a fraud detection expert for AfriFund. Analyze this project submission for potential fraud, spam, plagiarism, and calculate similarity scores.

Project Title: ${submission.project_title}
Project Description: ${projectDescription}
Applicant Email: ${submission.email}

DATABASE CHECKS ALREADY PERFORMED:
- Duplicate email check: ${duplicateEmails?.length || 0} matches found
- Duplicate phone check: ${duplicatePhones?.length || 0} matches found
- Same user multiple submissions: ${duplicateFromSameUser?.length || 0} found

Your task is to check for:
1. Copied/plagiarized content from the internet or well-known sources
2. Unrealistic or impossible claims (e.g., "will make $1 billion in 1 month")
3. Spam, nonsense text, or AI-generated garbage
4. Suspicious patterns in language or structure
5. Calculate similarity percentage with existing submissions (0-100%)
6. Compare with recent submissions to detect similar/copied content:
${existingSubmissions?.slice(0, 15).map(s => `Title: ${s.project_title}, Desc: ${s.project_description?.substring(0, 150)}`).join('\n\n')}

Respond in JSON format:
{
  "ai_fraud_detected": true/false,
  "ai_fraud_reason": "Brief explanation if AI detects fraud issues, or empty string if not",
  "content_similarity_found": true/false,
  "similarity_score": 0-100 (percentage of similarity with most similar existing submission),
  "similarity_explanation": "Explanation if similar content detected, mention which aspects are similar"
}

IMPORTANT: 
- similarity_score should be 0 if no significant similarity found
- similarity_score above 70 indicates high likelihood of plagiarism
- similarity_score between 40-70 indicates moderate similarity worth reviewing
- Consider both semantic meaning and word-level similarity

Focus on content quality and plagiarism detection. Database-level duplicates are already flagged.`;

    const fraudResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a fraud detection expert. Always respond with valid JSON only.' },
          { role: 'user', content: fraudPrompt }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      }),
    });

    if (!fraudResponse.ok) {
      const errorText = await fraudResponse.text();
      throw new Error(`OpenAI fraud detection error: ${errorText}`);
    }

    const fraudData = await fraudResponse.json();
    const aiFraudAnalysis = JSON.parse(fraudData.choices[0].message.content);

    // Extract similarity score
    const similarityScore = aiFraudAnalysis.similarity_score || 0;
    const isSimilarityHigh = similarityScore >= 70;
    const isSimilarityModerate = similarityScore >= 40 && similarityScore < 70;

    // Combine all fraud detection results
    if (aiFraudAnalysis.ai_fraud_detected) {
      fraudFlags.push(`AI detected: ${aiFraudAnalysis.ai_fraud_reason}`);
      isSuspectedFraud = true;
    }

    if (aiFraudAnalysis.content_similarity_found) {
      if (isSimilarityHigh) {
        fraudFlags.push(`High similarity (${similarityScore}%): ${aiFraudAnalysis.similarity_explanation}`);
        isSuspectedFraud = true;
        isPossibleDuplicate = true;
      } else if (isSimilarityModerate) {
        fraudFlags.push(`Moderate similarity (${similarityScore}%): ${aiFraudAnalysis.similarity_explanation}`);
        isPossibleDuplicate = true;
      }
    }

    // Find the most likely duplicate submission ID (if any)
    let duplicateId = null;
    if (duplicateFromSameUser && duplicateFromSameUser.length > 0) {
      duplicateId = duplicateFromSameUser[0].id;
    }

    const combinedFraudFlags = fraudFlags.join(' | ');

    // Update submission with AI analysis
    const { error: updateError } = await supabase
      .from('user_submissions')
      .update({
        language_detected: analysis.language_detected,
        category: analysis.category,
        ai_summary: analysis.ai_summary,
        ai_strengths: analysis.ai_strengths,
        ai_risks: analysis.ai_risks,
        ai_impact_score: analysis.ai_impact_score,
        ai_feasibility_score: analysis.ai_feasibility_score,
        ai_overall_score: analysis.ai_overall_score,
        ai_feedback_short: analysis.ai_feedback_short,
        ai_translation_en: analysis.ai_translation_en,
        ai_translation_fr: analysis.ai_translation_fr,
        ai_translation_sw: analysis.ai_translation_sw,
        ai_translation_ln: analysis.ai_translation_ln,
        is_suspected_fraud: isSuspectedFraud,
        fraud_flags: combinedFraudFlags || null,
        is_possible_duplicate: isPossibleDuplicate,
        duplicate_of_submission_id: duplicateId,
        ai_last_reviewed_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (updateError) {
      throw new Error(`Failed to update submission: ${updateError.message}`);
    }

    console.log(`AI analysis completed for submission ${submissionId}`);

    // Send fraud alert email if fraud detected
    if (isSuspectedFraud || isSimilarityHigh) {
      try {
        console.log(`Sending fraud alert for submission ${submissionId}`);
        
        const fraudAlertResponse = await fetch(`${supabaseUrl}/functions/v1/send-fraud-alert-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            submissionId: submission.id,
            confirmationId: submission.confirmation_id,
            applicantName: submission.full_name,
            applicantEmail: submission.email,
            projectTitle: submission.project_title,
            fraudFlags: fraudFlags,
            similarityScore: similarityScore > 0 ? similarityScore : undefined,
            duplicateCounts: {
              emails: duplicateEmails?.length || 0,
              phones: duplicatePhones?.length || 0,
              sameUser: duplicateFromSameUser?.length || 0,
            },
          }),
        });

        if (!fraudAlertResponse.ok) {
          console.error('Failed to send fraud alert email:', await fraudAlertResponse.text());
        } else {
          console.log('Fraud alert email sent successfully');
        }
      } catch (emailError) {
        console.error('Error sending fraud alert email:', emailError);
        // Don't fail the entire analysis if email fails
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        analysis: {
          ...analysis,
          is_suspected_fraud: isSuspectedFraud,
          fraud_flags: combinedFraudFlags,
          is_possible_duplicate: isPossibleDuplicate,
          similarity_score: similarityScore,
          duplicate_count: {
            emails: duplicateEmails?.length || 0,
            phones: duplicatePhones?.length || 0,
            sameUser: duplicateFromSameUser?.length || 0
          }
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in analyze-submission:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
