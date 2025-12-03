import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type AdminRole = 'super_admin' | 'finance' | 'operations' | 'support';

export interface AdminPermissions {
  role: AdminRole;
  canAccessOrders: boolean;
  canAccessPayments: boolean;
  canAccessUsers: boolean;
  canAccessAnalytics: boolean;
  canAccessSupport: boolean;
  canAccessCarts: boolean;
  canAccessSettings: boolean;
  canAccessShipping: boolean;
  canAccessKnowledgeBase: boolean;
  isSuperAdmin: boolean;
}

const ROLE_PERMISSIONS: Record<AdminRole, Omit<AdminPermissions, 'role'>> = {
  super_admin: {
    canAccessOrders: true,
    canAccessPayments: true,
    canAccessUsers: true,
    canAccessAnalytics: true,
    canAccessSupport: true,
    canAccessCarts: true,
    canAccessSettings: true,
    canAccessShipping: true,
    canAccessKnowledgeBase: true,
    isSuperAdmin: true,
  },
  finance: {
    canAccessOrders: false,
    canAccessPayments: true,
    canAccessUsers: false,
    canAccessAnalytics: true,
    canAccessSupport: false,
    canAccessCarts: false,
    canAccessSettings: false,
    canAccessShipping: false,
    canAccessKnowledgeBase: false,
    isSuperAdmin: false,
  },
  operations: {
    canAccessOrders: true,
    canAccessPayments: false,
    canAccessUsers: false,
    canAccessAnalytics: false,
    canAccessSupport: false,
    canAccessCarts: true,
    canAccessSettings: false,
    canAccessShipping: true,
    canAccessKnowledgeBase: false,
    isSuperAdmin: false,
  },
  support: {
    canAccessOrders: true,
    canAccessPayments: false,
    canAccessUsers: false,
    canAccessAnalytics: false,
    canAccessSupport: true,
    canAccessCarts: false,
    canAccessSettings: false,
    canAccessShipping: false,
    canAccessKnowledgeBase: true,
    isSuperAdmin: false,
  },
};

export function useAdminPermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<AdminPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    const loadPermissions = async () => {
      try {
        const { data } = await supabase
          .from('user_roles')
          .select('admin_role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single();

        if (data) {
          const role = (data.admin_role || 'support') as AdminRole;
          setPermissions({
            role,
            ...ROLE_PERMISSIONS[role],
          });
        } else {
          setPermissions(null);
        }
      } catch (error) {
        console.error('Error loading admin permissions:', error);
        setPermissions(null);
      } finally {
        setLoading(false);
      }
    };

    loadPermissions();
  }, [user]);

  return { permissions, loading };
}

export function getPermissionsForRole(role: AdminRole): AdminPermissions {
  return {
    role,
    ...ROLE_PERMISSIONS[role],
  };
}
