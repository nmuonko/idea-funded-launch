import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, apiRequest, forceSignOut } from '@/lib/api';

/**
 * Hook for making authenticated API requests
 * Uses the centralized API wrapper with automatic token management
 */
export function useAuthenticatedApi() {
  const { session, refreshSession, signOut } = useAuth();

  /**
   * Make an authenticated request with automatic token handling
   */
  const request = useCallback(async <T = any>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ) => {
    const result = await apiRequest<T>(endpoint, options);
    
    // If we got a forced logout, also call the context signOut
    if (result.status === 401 && result.error) {
      console.log('[useAuthenticatedApi] Auth failed, signing out via context');
    }
    
    return result;
  }, []);

  return {
    request,
    get: api.get,
    post: api.post,
    put: api.put,
    patch: api.patch,
    delete: api.delete,
    isAuthenticated: !!session?.access_token,
    forceSignOut,
  };
}

export default useAuthenticatedApi;
