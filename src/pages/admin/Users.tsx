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
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, User, Mail, UserPlus, Clock, CheckCircle, XCircle, Eye, EyeOff, RefreshCw, Calendar } from 'lucide-react';
import { StaffRoleSelector, RoleBadge } from '@/components/admin/StaffRoleSelector';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface UserWithRole {
  user_id: string;
  full_name: string | null;
  name: string | null;
  email?: string;
  isAdmin: boolean;
  adminRole: string;
  created_at?: string;
  last_sign_in_at?: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operations');
  const [inviteMethod, setInviteMethod] = useState<'email' | 'password'>('email');
  const [invitePassword, setInvitePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

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
      // Get all users from profiles with created_at
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name, name, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get all admin roles
      const { data: adminRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, admin_role')
        .eq('role', 'admin');

      if (rolesError) throw rolesError;

      const adminRolesMap = new Map(adminRoles?.map(r => [r.user_id, r.admin_role]) || []);

      const usersWithRoles = profiles?.map(profile => ({
        ...profile,
        isAdmin: adminRolesMap.has(profile.user_id),
        adminRole: adminRolesMap.get(profile.user_id) || 'super_admin',
      })) || [];

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
      const { data, error } = await supabase
        .from('admin_invitations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvitations(data || []);
    } catch (error: any) {
      console.error('Error loading invitations:', error);
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

      const { data, error } = await supabase.functions.invoke('admin-invite-user', {
        body: {
          email: inviteEmail.trim(),
          role: inviteRole,
          setPassword: inviteMethod === 'password' ? invitePassword : undefined,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: data.message,
      });

      setInviteDialogOpen(false);
      setInviteEmail('');
      setInvitePassword('');
      setInviteRole('operations');
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Error sending invitation',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const resendInvitation = async (invitationId: string) => {
    try {
      setResending(invitationId);

      const { data, error } = await supabase.functions.invoke('admin-invite-user', {
        body: { resend: true, invitationId },
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

  const promoteToAdmin = async (userId: string, adminRole: string = 'operations') => {
    try {
      setPromoting(userId);
      
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin', admin_role: adminRole });

      if (error) throw error;

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

  const revokeAdmin = async (userId: string) => {
    try {
      setPromoting(userId);
      
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
  const regularUsers = users.filter(u => !u.isAdmin);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage admin roles, invitations, and user permissions
          </p>
        </div>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite Admin
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
              <CardDescription>Users with administrative access</CardDescription>
            </CardHeader>
            <CardContent>
              {adminUsers.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No admin users found</p>
              ) : (
                <TooltipProvider>
                  <div className="space-y-3">
                    {adminUsers.map((user) => (
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
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <RoleBadge role={user.adminRole} />
                          <StaffRoleSelector
                            value={user.adminRole}
                            onChange={(newRole) => updateAdminRole(user.user_id, newRole)}
                            disabled={promoting === user.user_id}
                          />
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
                    ))}
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
              {invitations.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No invitations sent yet</p>
              ) : (
                <div className="space-y-3">
                  {invitations.map((invite) => {
                    const isExpired = new Date(invite.expires_at) < new Date();
                    const canResend = invite.status === 'pending';
                    
                    return (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <Mail className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{invite.email}</p>
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
                          )}
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
              <CardTitle>All Users</CardTitle>
              <CardDescription>{users.length} total users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {regularUsers.map((user) => (
                  <div
                    key={user.user_id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{user.full_name || user.name || 'Unnamed User'}</p>
                        <p className="text-sm text-muted-foreground">{user.user_id.slice(0, 8)}...</p>
                      </div>
                    </div>
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
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Admin User</DialogTitle>
            <DialogDescription>
              Send an invitation to add a new administrator
            </DialogDescription>
          </DialogHeader>

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
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
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
    </div>
  );
}
