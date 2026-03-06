import { supabase } from '@/integrations/supabase/client';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;


/**
 * Centralized API wrapper with automatic token management
 * - Always fetches fresh token before requests
 * - Handles 401 errors with token refresh
 * - Forces logout on persistent auth failures
 */

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
}

interface ApiResponse<T = any> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Get fresh access token from current session
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('[API] Error getting session:', error.message);
      return null;
    }
    
    if (!session?.access_token) {
      console.log('[API] No active session found');
      return null;
    }
    
    console.log('[API] Session loaded, token expires:', new Date(session.expires_at! * 1000).toISOString());
    return session.access_token;
  } catch (error) {
    console.error('[API] Exception getting token:', error);
    return null;
  }
}

/**
 * Attempt to refresh the session token
 */
async function refreshToken(): Promise<string | null> {
  try {
    console.log('[API] Attempting token refresh...');
    const { data: { session }, error } = await supabase.auth.refreshSession();
    
    if (error) {
      console.error('[API] Token refresh failed:', error.message);
      return null;
    }
    
    if (session?.access_token) {
      console.log('[API] Token refreshed successfully');
      return session.access_token;
    }
    
    return null;
  } catch (error) {
    console.error('[API] Exception refreshing token:', error);
    return null;
  }
}

/**
 * Force sign out and redirect to login
 */
export async function forceSignOut(): Promise<void> {
  console.log('[API] Forcing sign out due to auth failure');
  await supabase.auth.signOut();
  
  // Clear any stored session data
  localStorage.removeItem('rememberMe');
  sessionStorage.removeItem('sessionActive');
  
  // Redirect to login page
  if (window.location.pathname !== '/auth') {
    window.location.href = '/auth';
  }
}

/**
 * Make an authenticated API request to Supabase Edge Functions
 * - Always fetches fresh token
 * - Retries once on 401 with token refresh
 * - Forces logout on persistent auth failures
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {} } = options;
  
  // Get fresh token
  let token = await getAccessToken();
  
  if (!token) {
    console.log('[API] No token available, forcing sign out');
    await forceSignOut();
    return { data: null, error: 'No authentication token', status: 401 };
  }
  
  const url = `${SUPABASE_URL}/functions/v1/${endpoint}`;
  console.log(`[API] ${method} ${endpoint}`);
  
  const makeRequest = async (accessToken: string): Promise<Response> => {
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      ...headers,
    };
    
    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };
    
    if (body && method !== 'GET') {
      requestOptions.body = JSON.stringify(body);
    }
    
    return fetch(url, requestOptions);
  };
  
  try {
    let response = await makeRequest(token);
    
    // Handle 401 - try refreshing token once
    if (response.status === 401) {
      console.log('[API] Got 401, attempting token refresh...');
      
      const newToken = await refreshToken();
      
      if (newToken) {
        console.log('[API] Retrying request with refreshed token');
        response = await makeRequest(newToken);
      } else {
        console.log('[API] Token refresh failed, forcing sign out');
        await forceSignOut();
        return { data: null, error: 'Authentication failed', status: 401 };
      }
    }
    
    // Still got 401 after refresh
    if (response.status === 401) {
      console.log('[API] Still 401 after refresh, forcing sign out');
      await forceSignOut();
      return { data: null, error: 'Authentication failed', status: 401 };
    }
    
    // Parse response
    const contentType = response.headers.get('content-type');
    let data: T | null = null;
    
    if (contentType?.includes('application/json')) {
      const json = await response.json();
      
      // Check for JWT error in response body
      if (json.error && typeof json.error === 'string' && 
          json.error.toLowerCase().includes('jwt')) {
        console.log('[API] JWT error in response:', json.error);
        
        const newToken = await refreshToken();
        if (newToken) {
          const retryResponse = await makeRequest(newToken);
          if (retryResponse.ok) {
            data = await retryResponse.json();
            return { data, error: null, status: retryResponse.status };
          }
        }
        
        await forceSignOut();
        return { data: null, error: json.error, status: 401 };
      }
      
      data = json;
    }
    
    if (!response.ok) {
      const errorMessage = (data as any)?.error || `Request failed with status ${response.status}`;
      return { data: null, error: errorMessage, status: response.status };
    }
    
    return { data, error: null, status: response.status };
  } catch (error: any) {
    console.error('[API] Request exception:', error);
    return { data: null, error: error.message || 'Network error', status: 0 };
  }
}

/**
 * Convenience methods for common HTTP methods
 */
export const api = {
  get: <T = any>(endpoint: string, headers?: Record<string, string>) => 
    apiRequest<T>(endpoint, { method: 'GET', headers }),
    
  post: <T = any>(endpoint: string, body?: any, headers?: Record<string, string>) => 
    apiRequest<T>(endpoint, { method: 'POST', body, headers }),
    
  put: <T = any>(endpoint: string, body?: any, headers?: Record<string, string>) => 
    apiRequest<T>(endpoint, { method: 'PUT', body, headers }),
    
  patch: <T = any>(endpoint: string, body?: any, headers?: Record<string, string>) => 
    apiRequest<T>(endpoint, { method: 'PATCH', body, headers }),
    
  delete: <T = any>(endpoint: string, body?: any, headers?: Record<string, string>) => 
    apiRequest<T>(endpoint, { method: 'DELETE', body, headers }),
};

/**
 * Check if user has a valid session
 */
export async function isAuthenticated(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session?.access_token;
}

/**
 * Get current user from session
 */
export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
