import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  checkAdminStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const checkAdminStatus = async (userEmail?: string, userId?: string): Promise<boolean> => {
    try {
      const email = userEmail || user?.email;
      const uid = userId || user?.id;
      
      if (!email) {
        console.log('[Admin Check] No email available');
        setIsAdmin(false);
        return false;
      }

      console.log('[Admin Check] Checking email:', email);

      // Check both admin_users table and user_roles for redundancy
      const checks = [
        supabase
          .from('admin_users')
          .select('email')
          .eq('email', email)
          .maybeSingle()
      ];

      // Only check user_roles if we have a user ID
      if (uid) {
        checks.push(
          supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', uid)
            .eq('role', 'admin')
            .maybeSingle()
        );
      }

      const results = await Promise.all(checks);
      const adminCheck = results[0];
      const roleCheck = results[1];

      if (adminCheck.error && (!roleCheck || roleCheck.error)) {
        console.error('[Admin Check] Checks failed:', { 
          adminError: adminCheck.error, 
          roleError: roleCheck?.error 
        });
        setIsAdmin(false);
        return false;
      }

      // Admin if found in either table
      const adminStatus = !!adminCheck.data || (roleCheck && !!roleCheck.data);
      console.log('[Admin Check] Result:', { 
        found: adminStatus, 
        email,
        inAdminUsers: !!adminCheck.data,
        inUserRoles: roleCheck ? !!roleCheck.data : 'not checked'
      });
      setIsAdmin(adminStatus);
      return adminStatus;
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
        // Get initial session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        console.log('[Auth] Initialize:', session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user?.email) {
          await checkAdminStatus(session.user.email, session.user.id);
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('[Auth] Init error:', error);
        setIsAdmin(false);
      } finally {
        if (mounted) {
          setLoading(false);
          console.log('[Auth] Loading complete');
        }
      }
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('[Auth] State change:', event, session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user?.email) {
          await checkAdminStatus(session.user.email, session.user.id);
        } else {
          setIsAdmin(false);
        }
        
        setLoading(false);
        console.log('[Auth] Loading complete after state change');
      }
    );

    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
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

  const signUp = async (email: string, password: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
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
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      
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
