import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId } = await req.json();
    
    if (!submissionId) {
      throw new Error('submissionId is required');
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

    // Fetch all existing submissions for duplicate detection
    const { data: existingSubmissions } = await supabase
      .from('user_submissions')
      .select('id, project_description, project_title')
      .neq('id', submissionId);

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

    // Fraud detection
    const fraudPrompt = `You are a fraud detection expert for AfriFund. Analyze this project submission for potential fraud, spam, or plagiarism.

Project Title: ${submission.project_title}
Project Description: ${projectDescription}
Applicant Email: ${submission.email}

Check for:
1. Copied/plagiarized content from the internet
2. Unrealistic claims or budget
3. Spam or nonsense text
4. Suspicious patterns

Also compare with these existing submissions to detect duplicates:
${existingSubmissions?.slice(0, 20).map(s => `Title: ${s.project_title}, Desc: ${s.project_description?.substring(0, 200)}`).join('\n\n')}

Respond in JSON format:
{
  "is_suspected_fraud": true/false,
  "fraud_flags": "Brief explanation if fraud is suspected, or empty string if not",
  "is_possible_duplicate": true/false,
  "duplicate_of_submission_id": "UUID of duplicate submission or null",
  "duplicate_explanation": "Explanation if duplicate detected"
}`;

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
    const fraudAnalysis = JSON.parse(fraudData.choices[0].message.content);

    // Combine fraud flags with duplicate explanation
    let combinedFraudFlags = fraudAnalysis.fraud_flags || '';
    if (fraudAnalysis.is_possible_duplicate && fraudAnalysis.duplicate_explanation) {
      combinedFraudFlags = combinedFraudFlags 
        ? `${combinedFraudFlags}. ${fraudAnalysis.duplicate_explanation}`
        : fraudAnalysis.duplicate_explanation;
    }

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
        is_suspected_fraud: fraudAnalysis.is_suspected_fraud,
        fraud_flags: combinedFraudFlags,
        is_possible_duplicate: fraudAnalysis.is_possible_duplicate,
        duplicate_of_submission_id: fraudAnalysis.duplicate_of_submission_id,
        ai_last_reviewed_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (updateError) {
      throw new Error(`Failed to update submission: ${updateError.message}`);
    }

    console.log(`AI analysis completed for submission ${submissionId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        analysis: {
          ...analysis,
          ...fraudAnalysis
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