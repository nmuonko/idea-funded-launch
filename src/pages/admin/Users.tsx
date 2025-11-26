import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, User } from 'lucide-react';

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      
      // Get all users from profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name, name')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get all admin roles
      const { data: adminRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (rolesError) throw rolesError;

      const adminUserIds = new Set(adminRoles?.map(r => r.user_id) || []);

      // Combine data
      const usersWithRoles = profiles?.map(profile => ({
        ...profile,
        isAdmin: adminUserIds.has(profile.user_id),
      })) || [];

      setUsers(usersWithRoles);
    } catch (error: any) {
      toast({
        title: 'Error loading users',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const promoteToAdmin = async (userId: string) => {
    try {
      setPromoting(userId);
      
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin' });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User promoted to admin',
      });

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

  const revokeAdmin = async (userId: string) => {
    try {
      setPromoting(userId);
      
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Admin privileges revoked',
      });

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

  const addAdminByEmail = async () => {
    if (!newAdminEmail.trim()) return;

    try {
      setPromoting('email-lookup');
      
      // Query the profiles table to find user by email through auth.users
      // Since we can't directly query auth.users, we'll need to use an edge function
      // For now, just show a message to use the UI below
      toast({
        title: 'Use the user list below',
        description: 'Find the user in the list and click "Make Admin"',
        variant: 'default',
      });
      setNewAdminEmail('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setPromoting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage admin roles and user permissions
        </p>
      </div>

      {/* Promote by Email */}
      <Card>
        <CardHeader>
          <CardTitle>Promote User to Admin</CardTitle>
          <CardDescription>
            Enter a user's email address to grant them admin privileges
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="user@example.com"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAdminByEmail()}
            />
            <Button onClick={addAdminByEmail}>
              <Shield className="h-4 w-4 mr-2" />
              Promote to Admin
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users.length} total users
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {users.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{user.full_name || user.name || 'Unnamed User'}</p>
                    <p className="text-sm text-muted-foreground">{user.user_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {user.isAdmin ? (
                    <>
                      <Badge variant="default">
                        <Shield className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revokeAdmin(user.user_id)}
                        disabled={promoting === user.user_id}
                      >
                        {promoting === user.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Revoke Admin'
                        )}
                      </Button>
                    </>
                  ) : (
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
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
