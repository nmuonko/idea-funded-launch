import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: any; userId: string | null }>;
  signUp: (email: string, password: string, fullName: string, dateOfBirth: string, city: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  checkAdminStatus: (userId?: string) => Promise<boolean>;
  refreshSession: () => Promise<Session | null>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
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

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('[Auth] Starting initialization...');
        
        // Check if this is a password recovery flow - don't clear session if so
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const isRecoveryFlow = hashParams.get('type') === 'recovery';
        
        // Check if session should be cleared (user didn't select "remember me" and this is a new browser session)
        const rememberMe = localStorage.getItem('rememberMe');
        const sessionActive = sessionStorage.getItem('sessionActive');
        
        if (!rememberMe && !sessionActive && !isRecoveryFlow) {
          // New browser session and user didn't want to be remembered - clear auth
          console.log('[Auth] Clearing session - remember me was not selected');
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
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
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('[Auth] Init error:', error);
        setIsAdmin(false);
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
        
        // Defer admin check to avoid deadlock - CRITICAL for Supabase auth
        if (session?.user) {
          const userId = session.user.id;
          setTimeout(() => {
            console.log('[Auth] Deferred admin check for:', userId);
            checkAdminStatus(userId).then(() => {
              setLoading(false);
            });
          }, 0);
        } else {
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string, rememberMe: boolean = false) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        toast({
          title: 'Error',
          description: error.message,
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
      
      return { error: null, userId: data.user?.id ?? null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { error, userId: null };
    }
  };

  const signUp = async (email: string, password: string, fullName: string, dateOfBirth: string, city: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
            display_name: fullName,
            date_of_birth: dateOfBirth,
            city: city,
          },
        },
      });
      
      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Success',
          description: 'Account created! Please check your email to verify.',
        });
      }
      
      return { error };
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
        isAdmin, 
        loading, 
        signIn, 
        signUp, 
        signOut,
        checkAdminStatus,
        refreshSession,
        getAccessToken,
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
