import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface UserProfile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: any; userId: string | null }>;
  signUp: (email: string, password: string, fullName: string, phone?: string, profileData?: {
    country?: string;
    city?: string;
    province?: string;
    address_line1?: string;
    address_line2?: string;
    postal_code?: string;
  }) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  checkAdminStatus: (userId?: string) => Promise<boolean>;
  refreshSession: () => Promise<Session | null>;
  getAccessToken: () => Promise<string | null>;
  loadProfile: (userId: string) => Promise<UserProfile | null>;
  setProfile: (profile: UserProfile | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const checkAdminStatus = async (userId?: string): Promise<boolean> => {
    try {
      const uid = userId || user?.id;
      
      if (!uid) {
        console.log('[Admin Check] No user ID available');
        setIsAdmin(false);
        return false;
      }

      console.log('[Admin Check] Checking user:', { uid });

      // Direct query to user_roles table (RPC was hanging)
      console.log('[Admin Check] Querying user_roles...');
      const { data, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', uid)
        .eq('role', 'admin')
        .maybeSingle();

      console.log('[Admin Check] Query Response:', { data, roleError });

      if (roleError) {
        console.error('[Admin Check] Error checking role:', roleError);
        setIsAdmin(false);
        return false;
      }

      if (data && data.role === 'admin') {
        console.log('[Admin Check] ✅ User IS admin');
        setIsAdmin(true);
        return true;
      }

      console.log('[Admin Check] ❌ User is NOT admin');
      setIsAdmin(false);
      return false;
    } catch (error) {
      console.error('[Admin Check] Exception:', error);
      setIsAdmin(false);
      return false;
    }
  };

  // Load user profile from profiles table - creates one if missing
  const loadProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    try {
      console.log('[Auth] Loading profile for user:', userId);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Error loading profile:', error);
        return null;
      }

      if (data) {
        console.log('[Auth] Profile loaded:', {
          hasEmail: !!data.email,
          hasFullName: !!data.full_name,
          hasPhone: !!data.phone,
          hasAddress: !!data.address_line1,
        });
        setProfile(data as UserProfile);
        return data as UserProfile;
      }

      // Profile doesn't exist - create one from auth user data
      console.log('[Auth] No profile found, creating one...');
      
      // Get current user data for fallback values
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser) {
        console.log('[Auth] No auth user found to create profile');
        return null;
      }

      const userMeta = authUser.user_metadata || {};
      const fallbackName = userMeta.full_name || userMeta.name || authUser.email?.split('@')[0] || 'User';
      
      const newProfile = {
        user_id: userId,
        email: authUser.email?.toLowerCase() || null,
        full_name: fallbackName,
        name: fallbackName,
        phone: userMeta.phone || null,
        country: userMeta.country || 'DR Congo',
        language: userMeta.language || 'fr',
      };

      const { data: createdProfile, error: createError } = await supabase
        .from('profiles')
        .upsert(newProfile, { onConflict: 'user_id' })
        .select()
        .maybeSingle();

      if (createError) {
        console.error('[Auth] Error creating profile:', createError);
        // Return a synthetic profile from auth data so UI isn't blank
        const syntheticProfile: UserProfile = {
          id: userId,
          user_id: userId,
          email: authUser.email || null,
          full_name: fallbackName,
          name: fallbackName,
          phone: userMeta.phone || null,
          address_line1: null,
          address_line2: null,
          city: null,
          state_province: null,
          postal_code: null,
          country: 'DR Congo',
        };
        setProfile(syntheticProfile);
        return syntheticProfile;
      }

      if (createdProfile) {
        console.log('[Auth] Profile created successfully');
        setProfile(createdProfile as UserProfile);
        return createdProfile as UserProfile;
      }

      return null;
    } catch (error) {
      console.error('[Auth] Exception loading profile:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('[Auth] Starting initialization...');
        
        // Check if this is a password recovery flow - don't clear session if so
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const isRecoveryFlow = hashParams.get('type') === 'recovery';
        
        // Also check if we're on the reset password page (prevents race condition)
        const isResetPasswordPage = window.location.pathname === '/auth/reset-password';
        
        // Check if session should be cleared (user didn't select "remember me" and this is a new browser session)
        const rememberMe = localStorage.getItem('rememberMe');
        const sessionActive = sessionStorage.getItem('sessionActive');
        
        // Don't clear session if in recovery flow OR on reset password page
        if (!rememberMe && !sessionActive && !isRecoveryFlow && !isResetPasswordPage) {
          // New browser session and user didn't want to be remembered - clear auth
          console.log('[Auth] Clearing session - remember me was not selected');
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setProfile(null);
          setIsAdmin(false);
          setLoading(false);
          return;
        }
        
        // Get initial session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        console.log('[Auth] Session loaded:', session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          console.log('[Auth] Checking admin status for:', session.user.id);
          await checkAdminStatus(session.user.id);
          // Load profile on init
          await loadProfile(session.user.id);
        } else {
          setIsAdmin(false);
          setProfile(null);
        }
      } catch (error) {
        console.error('[Auth] Init error:', error);
        setIsAdmin(false);
        setProfile(null);
      } finally {
        if (mounted) {
          console.log('[Auth] Setting loading to false');
          setLoading(false);
        }
      }
    };

    // CRITICAL: onAuthStateChange callback must NOT be async and must NOT call Supabase functions directly
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        
        console.log('[Auth] State change event:', event, session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        // Handle PASSWORD_RECOVERY event - redirect to reset password page
        if (event === 'PASSWORD_RECOVERY') {
          console.log('[Auth] PASSWORD_RECOVERY event detected, redirecting to reset password page');
          // Use setTimeout to avoid calling navigate during render
          setTimeout(() => {
            window.location.href = '/auth/reset-password';
          }, 0);
          return;
        }
        
        // Defer admin check and profile load to avoid deadlock - CRITICAL for Supabase auth
        if (session?.user) {
          const userId = session.user.id;
          setTimeout(() => {
            console.log('[Auth] Deferred admin check and profile load for:', userId);
            Promise.all([
              checkAdminStatus(userId),
              loadProfile(userId)
            ]).then(() => {
              setLoading(false);
            });
          }, 0);
        } else {
          setIsAdmin(false);
          setProfile(null);
          setLoading(false);
        }
      }
    );

    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = async (email: string, password: string, rememberMe: boolean = false) => {
    try {
      // Preflight check: Validate Supabase config
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        console.error('[Auth] Missing Supabase config:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseKey,
          hostname: window.location.hostname,
        });
        toast({
          title: 'Configuration Error',
          description: 'Supabase environment variables are missing. Please contact the administrator.',
          variant: 'destructive',
        });
        return { error: new Error('Missing Supabase configuration'), userId: null };
      }

      // Preflight health check - lightweight connectivity test (non-blocking)
      try {
        const healthUrl = `${supabaseUrl}/auth/v1/health`;
        console.log('[Auth] Preflight health check:', healthUrl);
        
        const healthResponse = await fetch(healthUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
          },
        });
        
        if (!healthResponse.ok) {
          console.warn('[Auth] Health check returned:', healthResponse.status);
        } else {
          console.log('[Auth] Health check passed');
        }
      } catch (healthError: any) {
        // Log the error but don't block sign-in - the actual auth call may still work
        console.warn('[Auth] Preflight health check failed (non-blocking):', {
          error: healthError.message,
          name: healthError.name,
          hostname: window.location.hostname,
        });
        // Continue with sign-in attempt - don't return early
      }

      // Proceed with actual sign-in
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        console.error('[Auth] Sign in auth error:', {
          message: error.message,
          status: error.status,
          code: (error as any).code,
        });
        
        // Map common auth errors to user-friendly messages
        let userMessage = error.message;
        if (error.message === 'Invalid login credentials') {
          userMessage = 'Invalid email or password. Please try again.';
        } else if (error.message?.includes('Email not confirmed')) {
          userMessage = 'Please check your email and confirm your account before signing in.';
        }
        
        toast({
          title: 'Authentication Failed',
          description: userMessage,
          variant: 'destructive',
        });
        return { error, userId: null };
      }
      
      // Store remember me preference
      if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
      } else {
        localStorage.removeItem('rememberMe');
        sessionStorage.setItem('sessionActive', 'true');
      }

      // Load profile immediately after sign in
      if (data.user?.id) {
        await loadProfile(data.user.id);
      }
      
      return { error: null, userId: data.user?.id ?? null };
    } catch (error: any) {
      console.error('[Auth] Sign in exception:', {
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3),
        hostname: window.location.hostname,
        origin: window.location.origin,
      });
      
      // Classify the error type
      const isNetworkError = error.message === 'Failed to fetch' || 
                             error.name === 'TypeError' ||
                             error.message?.includes('network') ||
                             error.message?.includes('CORS') ||
                             error.message?.includes('blocked');
      
      const isCspError = error.message?.includes('Content Security Policy') ||
                         error.message?.includes('CSP');
      
      let title = 'Error';
      let description = error.message;
      
      if (isCspError) {
        title = 'Security Policy Error';
        description = 'Network blocked by site security policy (CSP). Please contact administrator.';
      } else if (isNetworkError) {
        title = 'Connection Error';
        description = 'Unable to connect to the authentication server. Please check your internet connection and try again.';
      }
      
      toast({
        title,
        description,
        variant: 'destructive',
      });
      return { error, userId: null };
    }
  };

  const signUp = async (
    email: string, 
    password: string, 
    fullName: string, 
    phone?: string,
    profileData?: {
      country?: string;
      city?: string;
      province?: string;
      address_line1?: string;
      address_line2?: string;
      postal_code?: string;
    }
  ) => {
    try {
      // Use production domain for email verification redirect
      const redirectUrl = 'https://afri-shop.com/email-confirmed';
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
            display_name: fullName,
            phone: phone || '',
          },
        },
      });
      
      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
        return { error };
      }

      // Create profile immediately after signup with all provided data
      if (data.user) {
        console.log('[Auth] Creating profile for new user:', data.user.id);
        
        const fullProfileData = {
          user_id: data.user.id,
          email: email.toLowerCase(),
          full_name: fullName,
          name: fullName,
          phone: phone || null,
          country: profileData?.country || null,
          city: profileData?.city || null,
          province: profileData?.province || null,
          address_line1: profileData?.address_line1 || null,
          address_line2: profileData?.address_line2 || null,
          postal_code: profileData?.postal_code || null,
        };

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert(fullProfileData, {
            onConflict: 'user_id',
          });

        if (profileError) {
          console.error('[Auth] Error creating profile:', profileError);
          // Don't fail signup if profile creation fails - it can be created later
        } else {
          console.log('[Auth] Profile created successfully');
          // Load the profile into state
          await loadProfile(data.user.id);
        }
      }
      
      toast({
        title: 'Success',
        description: 'Account created! Please check your email to verify.',
      });
      
      return { error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { error };
    }
  };

  const signOut = async () => {
    try {
      console.log('[Auth] Signing out...');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setUser(null);
      setSession(null);
      setProfile(null);
      setIsAdmin(false);
      
      // Clear stored session data
      localStorage.removeItem('rememberMe');
      sessionStorage.removeItem('sessionActive');
      
      toast({
        title: 'Signed out',
        description: 'You have been successfully signed out.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  /**
   * Refresh the current session and get new tokens
   */
  const refreshSession = useCallback(async (): Promise<Session | null> => {
    try {
      console.log('[Auth] Refreshing session...');
      const { data: { session: newSession }, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error('[Auth] Session refresh failed:', error.message);
        return null;
      }
      
      if (newSession) {
        console.log('[Auth] Session refreshed successfully');
        setSession(newSession);
        setUser(newSession.user);
        return newSession;
      }
      
      return null;
    } catch (error) {
      console.error('[Auth] Exception refreshing session:', error);
      return null;
    }
  }, []);

  /**
   * Get fresh access token - refreshes if needed
   */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      // First try to get current session
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (!currentSession) {
        console.log('[Auth] No session for token');
        return null;
      }
      
      // Check if token is close to expiry (within 60 seconds)
      const expiresAt = currentSession.expires_at;
      const now = Math.floor(Date.now() / 1000);
      
      if (expiresAt && expiresAt - now < 60) {
        console.log('[Auth] Token expiring soon, refreshing...');
        const refreshed = await refreshSession();
        return refreshed?.access_token ?? null;
      }
      
      console.log('[Auth] Token valid, expires:', new Date(expiresAt! * 1000).toISOString());
      return currentSession.access_token;
    } catch (error) {
      console.error('[Auth] Exception getting access token:', error);
      return null;
    }
  }, [refreshSession]);

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        session,
        profile,
        isAdmin, 
        loading, 
        signIn, 
        signUp, 
        signOut,
        checkAdminStatus,
        refreshSession,
        getAccessToken,
        loadProfile,
        setProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
