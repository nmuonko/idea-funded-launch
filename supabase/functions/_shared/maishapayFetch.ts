/**
 * Safe fetch wrapper for MaishaPay API calls
 * 
 * MaishaPay often returns empty response bodies (per their official docs).
 * Calling response.json() directly on empty bodies causes "undefined" errors.
 * This helper safely handles all response types.
 */

export interface MaishaPayResponse {
  ok: boolean;
  status: number;
  data: any;
  rawText: string;
}

export async function safeMaishaPayFetch(
  url: string,
  options: RequestInit
): Promise<MaishaPayResponse> {
  const response = await fetch(url, options);
  
  // Always read as text first - never call .json() directly
  const rawText = await response.text();

  console.log('[MaishaPay API] Response:', {
    url: url.replace(/Bearer\s+\S+/g, 'Bearer ***'),
    status: response.status,
    ok: response.ok,
    bodyLength: rawText.length,
    bodyPreview: rawText.substring(0, 200),
  });

  // Handle empty body (common in MaishaPay per their docs)
  if (!rawText || rawText.trim() === '') {
    console.log('[MaishaPay API] Empty response body - treating based on HTTP status');
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok 
        ? { success: true, _emptyResponse: true } 
        : { success: false, error: 'Empty response', _emptyResponse: true },
      rawText: '',
    };
  }

  // Try to parse as JSON
  try {
    const data = JSON.parse(rawText);
    return { ok: response.ok, status: response.status, data, rawText };
  } catch (parseError) {
    // Not valid JSON - return raw text wrapped in object
    console.log('[MaishaPay API] Response not JSON, wrapping raw text');
    return {
      ok: response.ok,
      status: response.status,
      data: { 
        success: response.ok, 
        rawResponse: rawText,
        _notJson: true,
      },
      rawText,
    };
  }
}

/**
 * Helper to safely parse a MaishaPay response that may be empty or non-JSON
 */
export function parseMaishaPayResponse(responseText: string, httpOk: boolean): any {
  if (!responseText || responseText.trim() === '') {
    return httpOk 
      ? { success: true, _emptyResponse: true }
      : { success: false, error: 'Empty response', _emptyResponse: true };
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { 
      success: httpOk, 
      rawResponse: responseText,
      _notJson: true,
    };
  }
}
