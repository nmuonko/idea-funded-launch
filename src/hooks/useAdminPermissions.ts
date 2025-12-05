import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type AdminRole = 'super_admin' | 'finance' | 'operations' | 'support';

export interface SectionPermissions {
  can_view_dashboard: boolean;
  can_view_orders: boolean;
  can_view_active_carts: boolean;
  can_view_saved_carts: boolean;
  can_view_ab_results: boolean;
  can_view_analytics: boolean;
  can_view_payments: boolean;
  can_view_shipping: boolean;
  can_manage_shipping_types: boolean;
  can_view_tickets: boolean;
  can_view_ticket_analytics: boolean;
  can_view_knowledge_base: boolean;
  can_view_customers: boolean;
  can_manage_users: boolean;
  can_view_settings: boolean;
  can_view_theme_settings: boolean;
}

export interface AdminPermissions extends SectionPermissions {
  role: AdminRole;
  isSuperAdmin: boolean;
}

// Default permissions for each role preset
export const ROLE_DEFAULT_PERMISSIONS: Record<AdminRole, SectionPermissions> = {
  super_admin: {
    can_view_dashboard: true,
    can_view_orders: true,
    can_view_active_carts: true,
    can_view_saved_carts: true,
    can_view_ab_results: true,
    can_view_analytics: true,
    can_view_payments: true,
    can_view_shipping: true,
    can_manage_shipping_types: true,
    can_view_tickets: true,
    can_view_ticket_analytics: true,
    can_view_knowledge_base: true,
    can_view_customers: true,
    can_manage_users: true,
    can_view_settings: true,
    can_view_theme_settings: true,
  },
  operations: {
    can_view_dashboard: true,
    can_view_orders: true,
    can_view_active_carts: true,
    can_view_saved_carts: true,
    can_view_ab_results: false,
    can_view_analytics: false,
    can_view_payments: false,
    can_view_shipping: true,
    can_manage_shipping_types: false,
    can_view_tickets: false,
    can_view_ticket_analytics: false,
    can_view_knowledge_base: false,
    can_view_customers: true,
    can_manage_users: false,
    can_view_settings: false,
    can_view_theme_settings: false,
  },
  finance: {
    can_view_dashboard: true,
    can_view_orders: false,
    can_view_active_carts: false,
    can_view_saved_carts: false,
    can_view_ab_results: true,
    can_view_analytics: true,
    can_view_payments: true,
    can_view_shipping: false,
    can_manage_shipping_types: false,
    can_view_tickets: false,
    can_view_ticket_analytics: false,
    can_view_knowledge_base: false,
    can_view_customers: false,
    can_manage_users: false,
    can_view_settings: false,
    can_view_theme_settings: false,
  },
  support: {
    can_view_dashboard: true,
    can_view_orders: true,
    can_view_active_carts: false,
    can_view_saved_carts: false,
    can_view_ab_results: false,
    can_view_analytics: false,
    can_view_payments: false,
    can_view_shipping: false,
    can_manage_shipping_types: false,
    can_view_tickets: true,
    can_view_ticket_analytics: true,
    can_view_knowledge_base: true,
    can_view_customers: true,
    can_manage_users: false,
    can_view_settings: false,
    can_view_theme_settings: false,
  },
};

// All permission keys for iteration
export const ALL_PERMISSION_KEYS: (keyof SectionPermissions)[] = [
  'can_view_dashboard',
  'can_view_orders',
  'can_view_active_carts',
  'can_view_saved_carts',
  'can_view_ab_results',
  'can_view_analytics',
  'can_view_payments',
  'can_view_shipping',
  'can_manage_shipping_types',
  'can_view_tickets',
  'can_view_ticket_analytics',
  'can_view_knowledge_base',
  'can_view_customers',
  'can_manage_users',
  'can_view_settings',
  'can_view_theme_settings',
];

// Permission labels for UI
export const PERMISSION_LABELS: Record<keyof SectionPermissions, { label: string; category: string }> = {
  can_view_dashboard: { label: 'Dashboard', category: 'Core' },
  can_view_orders: { label: 'Orders', category: 'Core' },
  can_view_active_carts: { label: 'Active Carts', category: 'Core' },
  can_view_saved_carts: { label: 'Saved Carts', category: 'Core' },
  can_view_ab_results: { label: 'A/B Test Results', category: 'Experiments & Analytics' },
  can_view_analytics: { label: 'Analytics', category: 'Experiments & Analytics' },
  can_view_payments: { label: 'Payments', category: 'Payments & Shipping' },
  can_view_shipping: { label: 'Shipping', category: 'Payments & Shipping' },
  can_manage_shipping_types: { label: 'Shipping Types', category: 'Payments & Shipping' },
  can_view_tickets: { label: 'Support Tickets', category: 'Support & Knowledge' },
  can_view_ticket_analytics: { label: 'Ticket Analytics', category: 'Support & Knowledge' },
  can_view_knowledge_base: { label: 'Knowledge Base', category: 'Support & Knowledge' },
  can_view_customers: { label: 'Customers', category: 'Core' },
  can_manage_users: { label: 'Staff Management', category: 'Admin & Settings' },
  can_view_settings: { label: 'Settings', category: 'Admin & Settings' },
  can_view_theme_settings: { label: 'Theme Settings', category: 'Admin & Settings' },
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
        // Get admin role
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('admin_role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single();

        if (!roleData) {
          setPermissions(null);
          setLoading(false);
          return;
        }

        const role = (roleData.admin_role || 'support') as AdminRole;
        const isSuperAdmin = role === 'super_admin';

        // Super admin always has all permissions
        if (isSuperAdmin) {
          setPermissions({
            role,
            isSuperAdmin: true,
            ...ROLE_DEFAULT_PERMISSIONS.super_admin,
          });
          setLoading(false);
          return;
        }

        // Get granular permissions from admin_user_permissions table
        const { data: permData } = await supabase
          .from('admin_user_permissions')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (permData) {
          setPermissions({
            role,
            isSuperAdmin: false,
            can_view_dashboard: permData.can_view_dashboard,
            can_view_orders: permData.can_view_orders,
            can_view_active_carts: permData.can_view_active_carts,
            can_view_saved_carts: permData.can_view_saved_carts,
            can_view_ab_results: permData.can_view_ab_results,
            can_view_analytics: permData.can_view_analytics,
            can_view_payments: permData.can_view_payments,
            can_view_shipping: permData.can_view_shipping,
            can_manage_shipping_types: permData.can_manage_shipping_types,
            can_view_tickets: permData.can_view_tickets,
            can_view_ticket_analytics: permData.can_view_ticket_analytics,
            can_view_knowledge_base: permData.can_view_knowledge_base,
            can_view_customers: permData.can_view_customers ?? false,
            can_manage_users: permData.can_manage_users,
            can_view_settings: permData.can_view_settings,
            can_view_theme_settings: permData.can_view_theme_settings,
          });
        } else {
          // Fallback to role defaults if no custom permissions
          setPermissions({
            role,
            isSuperAdmin: false,
            ...ROLE_DEFAULT_PERMISSIONS[role],
          });
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
    isSuperAdmin: role === 'super_admin',
    ...ROLE_DEFAULT_PERMISSIONS[role],
  };
}

// Helper to get summary of enabled permissions
export function getPermissionsSummary(perms: SectionPermissions): string[] {
  const summary: string[] = [];
  if (perms.can_view_orders) summary.push('Orders');
  if (perms.can_view_active_carts || perms.can_view_saved_carts) summary.push('Carts');
  if (perms.can_view_payments) summary.push('Payments');
  if (perms.can_view_shipping) summary.push('Shipping');
  if (perms.can_view_tickets) summary.push('Support');
  if (perms.can_view_analytics) summary.push('Analytics');
  if (perms.can_view_customers) summary.push('Customers');
  if (perms.can_manage_users) summary.push('Staff');
  return summary;
}
