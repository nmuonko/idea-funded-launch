import "https://deno.land/x/xhr@0.1.0/mod.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { requireAuthenticatedUser, guardErrorResponse } from "../_shared/securityGuards.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Process base64 in chunks to prevent memory issues
function processBase64Chunks(base64String: string, chunkSize = 32768) {
  const chunks: Uint8Array[] = [];
  let position = 0;
  
  while (position < base64String.length) {
    const chunk = base64String.slice(position, position + chunkSize);
    const binaryChunk = atob(chunk);
    const bytes = new Uint8Array(binaryChunk.length);
    
    for (let i = 0; i < binaryChunk.length; i++) {
      bytes[i] = binaryChunk.charCodeAt(i);
    }
    
    chunks.push(bytes);
    position += chunkSize;
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    try {
      await requireAuthenticatedUser(req);
    } catch (e) {
      return guardErrorResponse(e, corsHeaders);
    }

    const { audio, language, mimeType } = await req.json()

    if (!audio) {
      throw new Error('No audio data provided')
    }

    // Reject audio larger than ~25MB (OpenAI Whisper hard limit) — base64 inflates ~33%.
    if (typeof audio === 'string' && audio.length > 35_000_000) {
      return new Response(JSON.stringify({ error: 'Audio file too large (max 25MB)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Transcribing audio with language:', language || 'auto-detect', 'mimeType:', mimeType)

    // Process audio in chunks
    const binaryAudio = processBase64Chunks(audio)
    
    if (binaryAudio.length < 1000) {
      throw new Error('Audio data too small or corrupted')
    }
    
    // Prepare form data with appropriate mime type
    const formData = new FormData()
    // Default to webm if no mime type provided
    const audioType = mimeType || 'audio/webm'
    const fileExtension = audioType.includes('mp4') ? 'mp4' : 
                         audioType.includes('ogg') ? 'ogg' : 'webm'
    
    const blob = new Blob([binaryAudio], { type: audioType })
    formData.append('file', blob, `audio.${fileExtension}`)
    formData.append('model', 'whisper-1')
    
    // Add language if specified for better accuracy
    if (language) {
      formData.append('language', language)
    }
    
    console.log('Sending audio to OpenAI:', blob.size, 'bytes')

    // Send to OpenAI
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', errorText)
      throw new Error(`OpenAI API error: ${errorText}`)
    }

    const result = await response.json()
    console.log('Transcription successful, text length:', result.text?.length || 0)

    return new Response(
      JSON.stringify({ text: result.text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Transcription error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
