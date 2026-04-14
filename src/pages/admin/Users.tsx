import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, User, Mail, UserPlus, Clock, CheckCircle, XCircle, Eye, EyeOff, RefreshCw, Calendar, Copy, AlertCircle, Settings2, Phone, MapPin, Globe, Languages, Trash2 } from 'lucide-react';
import { StaffRoleSelector, RoleBadge } from '@/components/admin/StaffRoleSelector';
import { PermissionsEditor, PermissionsSummaryBadges, applyRoleDefaults } from '@/components/admin/PermissionsEditor';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { 
  SectionPermissions, 
  AdminRole, 
  ROLE_DEFAULT_PERMISSIONS,
  ALL_PERMISSION_KEYS 
} from '@/hooks/useAdminPermissions';

interface UserWithRole {
  user_id: string;
  full_name: string | null;
  name: string | null;
  email?: string;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  province?: string | null;
  language?: string | null;
  isAdmin: boolean;
  adminRole: string;
  created_at?: string;
  last_sign_in_at?: string;
  permissions?: SectionPermissions;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  email_sent: boolean | null;
  invite_url: string | null;
  token: string;
}

const DEFAULT_PERMISSIONS: SectionPermissions = {
  can_view_dashboard: true,
  can_view_orders: false,
  can_view_active_carts: false,
  can_view_saved_carts: false,
  can_view_ab_results: false,
  can_view_analytics: false,
  can_view_payments: false,
  can_view_shipping: false,
  can_manage_shipping_types: false,
  can_view_tickets: false,
  can_view_ticket_analytics: false,
  can_view_knowledge_base: false,
  can_view_customers: false,
  can_manage_users: false,
  can_view_settings: false,
  can_view_theme_settings: false,
  can_view_marketing: false,
};

export default function AdminUsers() {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRole>('operations');
  const [invitePermissions, setInvitePermissions] = useState<SectionPermissions>(ROLE_DEFAULT_PERMISSIONS.operations);
  const [inviteMethod, setInviteMethod] = useState<'email' | 'password'>('email');
  const [invitePassword, setInvitePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [deletingInvite, setDeletingInvite] = useState<string | null>(null);
  const [selectedInvites, setSelectedInvites] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  // Filters for profiles
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterProvince, setFilterProvince] = useState<string>('all');
  const [filterLanguage, setFilterLanguage] = useState<string>('all');
  
  // Edit permissions dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [editPermissions, setEditPermissions] = useState<SectionPermissions>(DEFAULT_PERMISSIONS);
  const [savingPermissions, setSavingPermissions] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  // When role changes in invite dialog, apply role defaults
  useEffect(() => {
    setInvitePermissions(ROLE_DEFAULT_PERMISSIONS[inviteRole]);
  }, [inviteRole]);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadUsers(), loadInvitations()]);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      // Get all users from profiles with all profile fields
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, name, phone, address, country, province, language, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get all admin roles
      const { data: adminRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, admin_role')
        .eq('role', 'admin');

      if (rolesError) throw rolesError;

      // Get all admin permissions
      const { data: permissionsData } = await supabase
        .from('admin_user_permissions')
        .select('*');

      const adminRolesMap = new Map(adminRoles?.map(r => [r.user_id, r.admin_role]) || []);
      const permissionsMap = new Map(permissionsData?.map(p => [p.user_id, p]) || []);

      const usersWithRoles = profiles?.map(profile => {
        const adminRole = adminRolesMap.get(profile.user_id) || 'super_admin';
        const perms = permissionsMap.get(profile.user_id);
        
        return {
          ...profile,
          isAdmin: adminRolesMap.has(profile.user_id),
          adminRole,
          permissions: perms ? {
            can_view_dashboard: perms.can_view_dashboard,
            can_view_orders: perms.can_view_orders,
            can_view_active_carts: perms.can_view_active_carts,
            can_view_saved_carts: perms.can_view_saved_carts,
            can_view_ab_results: perms.can_view_ab_results,
            can_view_analytics: perms.can_view_analytics,
            can_view_payments: perms.can_view_payments,
            can_view_shipping: perms.can_view_shipping,
            can_manage_shipping_types: perms.can_manage_shipping_types,
            can_view_tickets: perms.can_view_tickets,
            can_view_ticket_analytics: perms.can_view_ticket_analytics,
            can_view_knowledge_base: perms.can_view_knowledge_base,
            can_view_customers: perms.can_view_customers ?? false,
            can_manage_users: perms.can_manage_users,
            can_view_settings: perms.can_view_settings,
            can_view_theme_settings: perms.can_view_theme_settings,
            can_view_marketing: perms.can_view_marketing ?? false,
          } : ROLE_DEFAULT_PERMISSIONS[adminRole as AdminRole] || DEFAULT_PERMISSIONS,
        };
      }) || [];

      setUsers(usersWithRoles);
    } catch (error: any) {
      toast({
        title: 'Error loading users',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const loadInvitations = async () => {
    try {
      console.log('[Users] Loading invitations...');
      const { data, error } = await supabase
        .from('admin_invitations')
        .select('*')
        .neq('status', 'accepted')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Users] Error loading invitations:', error);
        throw error;
      }
      console.log('[Users] Loaded invitations:', data?.length || 0, data);
      setInvitations(data || []);
    } catch (error: any) {
      console.error('[Users] Error loading invitations:', error);
      toast({
        title: 'Error loading invitations',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const sendInvitation = async () => {
    if (!inviteEmail.trim()) {
      toast({ title: 'Email is required', variant: 'destructive' });
      return;
    }

    if (inviteMethod === 'password' && !invitePassword.trim()) {
      toast({ title: 'Password is required', variant: 'destructive' });
      return;
    }

    try {
      setInviting(true);

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: {
          action: 'invite_user',
          email: inviteEmail.trim(),
          role: inviteRole,
          permissions: invitePermissions,
          setPassword: inviteMethod === 'password' ? invitePassword : undefined,
        },
      });

      // Handle edge function errors - extract error from response body or error object
      if (error) {
        // Check if the error message contains JSON with a more specific error
        let errorMessage = error.message;
        try {
          // Sometimes the error body is embedded in the message
          if (error.context?.body) {
            const bodyError = JSON.parse(error.context.body);
            errorMessage = bodyError.error || errorMessage;
          }
        } catch (e) {
          // Ignore parse errors, use original message
        }
        throw new Error(errorMessage);
      }
      
      // Check if data contains an error field (from non-2xx responses that still return data)
      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: 'Success',
        description: data?.message || 'Invitation sent successfully',
      });

      setInviteDialogOpen(false);
      setInviteEmail('');
      setInvitePassword('');
      setInviteRole('operations');
      setInvitePermissions(ROLE_DEFAULT_PERMISSIONS.operations);
      await loadData();
    } catch (error: any) {
      // Provide more specific error messages for known errors
      let errorDesc = error.message || 'Unknown error occurred';
      if (errorDesc.includes('already an admin')) {
        errorDesc = 'This user is already an administrator';
      } else if (errorDesc.includes('non-2xx')) {
        errorDesc = 'Server error - please check if this user already exists';
      }
      
      toast({
        title: 'Error sending invitation',
        description: errorDesc,
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const resendInvitation = async (invitationId: string) => {
    try {
      setResending(invitationId);

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'invite_user', resend: true, invitationId },
      });

      if (error) throw error;

      toast({
        title: data.emailSent ? 'Invitation Resent' : 'Invitation Updated',
        description: data.emailSent 
          ? 'Email has been resent successfully' 
          : `Email service unavailable. Share this link: ${data.inviteUrl || 'Check invitation details'}`,
        variant: data.emailSent ? 'default' : 'destructive',
      });

      await loadInvitations();
    } catch (error: any) {
      toast({
        title: 'Error resending invitation',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setResending(null);
    }
  };

  const deleteInvitation = async (invitationId: string) => {
    try {
      setDeletingInvite(invitationId);
      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'delete_invitation', invitationId },
      });
      if (error) throw error;
      toast({ title: 'Invitation deleted' });
      setSelectedInvites(prev => { const n = new Set(prev); n.delete(invitationId); return n; });
      await loadInvitations();
    } catch (error: any) {
      toast({ title: 'Error deleting invitation', description: error.message, variant: 'destructive' });
    } finally {
      setDeletingInvite(null);
    }
  };

  const bulkDeleteInvitations = async () => {
    if (selectedInvites.size === 0) return;
    try {
      setBulkDeleting(true);
      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'delete_invitation', invitationIds: Array.from(selectedInvites) },
      });
      if (error) throw error;
      toast({ title: `${selectedInvites.size} invitation(s) deleted` });
      setSelectedInvites(new Set());
      await loadInvitations();
    } catch (error: any) {
      toast({ title: 'Error deleting invitations', description: error.message, variant: 'destructive' });
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleInviteSelection = (id: string) => {
    setSelectedInvites(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleAllInvites = () => {
    if (selectedInvites.size === invitations.length) {
      setSelectedInvites(new Set());
    } else {
      setSelectedInvites(new Set(invitations.map(i => i.id)));
    }
  };


  const promoteToAdmin = async (userId: string, adminRole: string = 'operations') => {
    try {
      setPromoting(userId);
      
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin', admin_role: adminRole });

      if (error) throw error;

      // Create default permissions for the new admin
      const defaultPerms = ROLE_DEFAULT_PERMISSIONS[adminRole as AdminRole] || DEFAULT_PERMISSIONS;
      await supabase
        .from('admin_user_permissions')
        .upsert({
          user_id: userId,
          ...defaultPerms,
        });

      toast({ title: 'Success', description: 'User promoted to admin' });
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Error promoting user',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setPromoting(null);
    }
  };

  const updateAdminRole = async (userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ admin_role: newRole })
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) throw error;

      // Update permissions to role defaults
      const defaultPerms = ROLE_DEFAULT_PERMISSIONS[newRole as AdminRole] || DEFAULT_PERMISSIONS;
      await supabase
        .from('admin_user_permissions')
        .upsert({
          user_id: userId,
          ...defaultPerms,
        });

      toast({ title: 'Success', description: 'Admin role updated' });
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Error updating role',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const openEditPermissions = (user: UserWithRole) => {
    setEditingUser(user);
    setEditPermissions(user.permissions || DEFAULT_PERMISSIONS);
    setEditDialogOpen(true);
  };

  const savePermissions = async () => {
    if (!editingUser) return;

    try {
      setSavingPermissions(true);

      const { error } = await supabase
        .from('admin_user_permissions')
        .upsert({
          user_id: editingUser.user_id,
          ...editPermissions,
        }, { onConflict: 'user_id' });

      if (error) throw error;

      toast({ title: 'Success', description: 'Permissions updated successfully' });
      setEditDialogOpen(false);
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Error saving permissions',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSavingPermissions(false);
    }
  };

  const revokeAdmin = async (userId: string) => {
    try {
      setPromoting(userId);
      
      // Delete permissions first
      await supabase
        .from('admin_user_permissions')
        .delete()
        .eq('user_id', userId);

      // Then delete role
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) throw error;

      toast({ title: 'Success', description: 'Admin privileges revoked' });
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Error revoking admin',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setPromoting(null);
    }
  };

  const getStatusBadge = (status: string, expiresAt: string) => {
    const isExpired = new Date(expiresAt) < new Date();
    if (isExpired && status === 'pending') {
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Expired</Badge>;
    }
    switch (status) {
      case 'pending':
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'accepted':
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Accepted</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const adminUsers = users.filter(u => u.isAdmin);
  
  // Get unique filter options
  const countries = [...new Set(users.map(u => u.country).filter(Boolean))];
  const provinces = [...new Set(users.map(u => u.province).filter(Boolean))];
  const languages = [...new Set(users.map(u => u.language).filter(Boolean))];
  
  // Filter users based on selected filters
  const filteredUsers = users.filter(u => {
    if (filterCountry !== 'all' && u.country !== filterCountry) return false;
    if (filterProvince !== 'all' && u.province !== filterProvince) return false;
    if (filterLanguage !== 'all' && u.language !== filterLanguage) return false;
    return true;
  });
  
  const regularUsers = filteredUsers.filter(u => !u.isAdmin);
  
  const getLanguageLabel = (lang: string) => {
    switch (lang) {
      case 'fr': return 'Français';
      case 'en': return 'English';
      case 'sw': return 'Kiswahili';
      case 'ln': return 'Lingala';
      default: return lang;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.userManagement}</h1>
          <p className="text-muted-foreground mt-2">
            {t.users.subtitle}
          </p>
        </div>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          {t.users.inviteUser}
        </Button>
      </div>

      <Tabs defaultValue="admins" className="space-y-4">
        <TabsList>
          <TabsTrigger value="admins">
            Admin Users ({adminUsers.length})
          </TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations ({invitations.length})
          </TabsTrigger>
          <TabsTrigger value="all">
            All Users ({users.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle>Admin Users</CardTitle>
              <CardDescription>Users with administrative access. Click gear icon to manage section permissions.</CardDescription>
            </CardHeader>
            <CardContent>
              {adminUsers.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No admin users found</p>
              ) : (
                <TooltipProvider>
                  <div className="space-y-3">
                    {adminUsers.map((user) => {
                      const isSuperAdmin = user.adminRole === 'super_admin';
                      
                      return (
                        <div
                          key={user.user_id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Shield className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{user.full_name || user.name || 'Unnamed User'}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{user.user_id.slice(0, 8)}...</span>
                                {user.created_at && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="flex items-center gap-1 cursor-help">
                                        <Calendar className="h-3 w-3" />
                                        {format(new Date(user.created_at), 'MMM dd, yyyy')}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Account created</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              {/* Permission summary */}
                              <div className="mt-1">
                                {isSuperAdmin ? (
                                  <span className="text-xs text-primary font-medium">Full Access</span>
                                ) : user.permissions ? (
                                  <PermissionsSummaryBadges permissions={user.permissions} />
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <RoleBadge role={user.adminRole} />
                            <StaffRoleSelector
                              value={user.adminRole}
                              onChange={(newRole) => updateAdminRole(user.user_id, newRole)}
                              disabled={promoting === user.user_id}
                            />
                            {!isSuperAdmin && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => openEditPermissions(user)}
                                  >
                                    <Settings2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit Section Permissions</TooltipContent>
                              </Tooltip>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => revokeAdmin(user.user_id)}
                              disabled={promoting === user.user_id}
                            >
                              {promoting === user.user_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Revoke'
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
              <CardDescription>Admin invitations sent to users</CardDescription>
            </CardHeader>
            <CardContent>
              {invitations.length > 0 && (
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedInvites.size === invitations.length}
                      onChange={toggleAllInvites}
                      className="rounded border-border"
                    />
                    Select all ({selectedInvites.size}/{invitations.length})
                  </label>
                  {selectedInvites.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={bulkDeleteInvitations}
                      disabled={bulkDeleting}
                    >
                      {bulkDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Trash2 className="h-3 w-3 mr-1" />
                      )}
                      Delete {selectedInvites.size} selected
                    </Button>
                  )}
                </div>
              )}
              {invitations.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No invitations sent yet</p>
              ) : (
                <div className="space-y-3">
                  {invitations.map((invite) => {
                    const isExpired = new Date(invite.expires_at) < new Date();
                    const canResend = invite.status === 'pending';
                    const inviteUrl = invite.invite_url || `${window.location.origin}/accept-invite?token=${invite.token}`;
                    
                    const copyInviteLink = async () => {
                      try {
                        await navigator.clipboard.writeText(inviteUrl);
                        toast({ title: 'Link copied', description: 'Invite link copied to clipboard' });
                      } catch {
                        toast({ title: 'Copy failed', variant: 'destructive' });
                      }
                    };
                    
                    return (
                      <div
                        key={invite.id}
                        className={`flex items-center justify-between p-4 border rounded-lg ${selectedInvites.has(invite.id) ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedInvites.has(invite.id)}
                            onChange={() => toggleInviteSelection(invite.id)}
                            className="rounded border-border"
                          />
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <Mail className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{invite.email}</p>
                              {invite.email_sent === true && (
                                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Email Sent
                                </Badge>
                              )}
                              {invite.email_sent === false && (
                                <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Email Failed
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Invited {format(new Date(invite.created_at), 'MMM dd, yyyy')}
                              {!isExpired && invite.status === 'pending' && (
                                <> · Expires {format(new Date(invite.expires_at), 'MMM dd')}</>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <RoleBadge role={invite.role} />
                          {getStatusBadge(invite.status, invite.expires_at)}
                          {canResend && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={copyInviteLink}
                              >
                                <Copy className="h-3 w-3 mr-1" />
                                Copy Link
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => resendInvitation(invite.id)}
                                disabled={resending === invite.id}
                              >
                                {resending === invite.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Resend
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteInvitation(invite.id)}
                            disabled={deletingInvite === invite.id}
                          >
                            {deletingInvite === invite.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Users / Profiles</CardTitle>
              <CardDescription>{filteredUsers.length} of {users.length} users</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-3 pb-4 border-b">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterCountry} onValueChange={setFilterCountry}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Country" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Countries</SelectItem>
                      {countries.map(c => (
                        <SelectItem key={c} value={c!}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterProvince} onValueChange={setFilterProvince}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Province" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Provinces</SelectItem>
                      {provinces.map(p => (
                        <SelectItem key={p} value={p!}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  <Select value={filterLanguage} onValueChange={setFilterLanguage}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Languages</SelectItem>
                      {languages.map(l => (
                        <SelectItem key={l} value={l!}>{getLanguageLabel(l!)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Users List */}
              <div className="space-y-3">
                {filteredUsers.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No users match the selected filters</p>
                ) : (
                  filteredUsers.map((user) => (
                    <div
                      key={user.user_id}
                      className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            {user.isAdmin ? (
                              <Shield className="h-5 w-5 text-primary" />
                            ) : (
                              <User className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{user.full_name || user.name || 'Unnamed User'}</p>
                              {user.isAdmin && <RoleBadge role={user.adminRole} />}
                              {user.language && (
                                <Badge variant="outline" className="text-xs">
                                  {getLanguageLabel(user.language)}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              {user.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {user.email}
                                </span>
                              )}
                              {user.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {user.phone}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                              {(user.country || user.province) && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {[user.province, user.country].filter(Boolean).join(', ')}
                                </span>
                              )}
                              {user.address && (
                                <span className="truncate max-w-[300px]" title={user.address}>
                                  {user.address}
                                </span>
                              )}
                            </div>
                            {user.created_at && (
                              <p className="text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3 inline mr-1" />
                                Joined {format(new Date(user.created_at), 'MMM dd, yyyy')}
                              </p>
                            )}
                          </div>
                        </div>
                        {!user.isAdmin && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => promoteToAdmin(user.user_id)}
                            disabled={promoting === user.user_id}
                          >
                            {promoting === user.user_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Make Admin'
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Invite Admin User</DialogTitle>
            <DialogDescription>
              Send an invitation to add a new administrator with custom permissions
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="admin@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Role Preset</Label>
                <Select value={inviteRole} onValueChange={(v: AdminRole) => setInviteRole(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin - Full access</SelectItem>
                    <SelectItem value="operations">Operations - Orders & Carts</SelectItem>
                    <SelectItem value="finance">Finance - Payments & Analytics</SelectItem>
                    <SelectItem value="support">Support - Tickets & Help</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Select a preset to auto-fill permissions, then customize below
                </p>
              </div>

              {/* Section Access Permissions */}
              <div className="space-y-2">
                <Label>Section Access</Label>
                <div className="border rounded-lg p-4 bg-muted/30">
                  <PermissionsEditor
                    permissions={invitePermissions}
                    onChange={setInvitePermissions}
                    isSuperAdmin={inviteRole === 'super_admin'}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Invitation Method</Label>
                <Select value={inviteMethod} onValueChange={(v: 'email' | 'password') => setInviteMethod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Send email invitation link</SelectItem>
                    <SelectItem value="password">Set password manually</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {inviteMethod === 'password' && (
                <div className="space-y-2">
                  <Label>Initial Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter password for new user"
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share this password securely with the new admin
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendInvitation} disabled={inviting}>
              {inviting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              {inviteMethod === 'email' ? 'Send Invitation' : 'Create Admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Section Permissions</DialogTitle>
            <DialogDescription>
              Customize which admin sections {editingUser?.full_name || editingUser?.name || 'this user'} can access
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="py-4">
              <PermissionsEditor
                permissions={editPermissions}
                onChange={setEditPermissions}
              />
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePermissions} disabled={savingPermissions}>
              {savingPermissions ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
