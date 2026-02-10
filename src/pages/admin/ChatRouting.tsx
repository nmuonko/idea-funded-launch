import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Loader2,
  ArrowUp,
  ArrowDown,
  Plus,
  RefreshCw,
  Users,
  MessageCircle,
  Settings2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';

interface RoutingEntry {
  id: string;
  admin_user_id: string;
  admin_email: string | null;
  admin_name: string | null;
  is_available: boolean;
  priority_order: number;
  chats_assigned_count: number;
  last_assigned_at: string | null;
}

interface AdminUser {
  id: string;
  email: string;
}

export default function ChatRouting() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [entries, setEntries] = useState<RoutingEntry[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAdminToAdd, setSelectedAdminToAdd] = useState('');

  const txt = {
    title: language === 'fr' ? 'Routage des Chats' : 'Chat Routing',
    subtitle: language === 'fr' 
      ? 'Gérez la distribution automatique des conversations entre les agents' 
      : 'Manage automatic chat distribution among agents',
    agent: language === 'fr' ? 'Agent' : 'Agent',
    available: language === 'fr' ? 'Disponible' : 'Available',
    priority: language === 'fr' ? 'Priorité' : 'Priority',
    assigned: language === 'fr' ? 'Assignés' : 'Assigned',
    lastAssigned: language === 'fr' ? 'Dernière assignation' : 'Last Assigned',
    actions: language === 'fr' ? 'Actions' : 'Actions',
    addAgent: language === 'fr' ? 'Ajouter un agent' : 'Add Agent',
    noAgents: language === 'fr' ? 'Aucun agent configuré' : 'No agents configured',
    selectAgent: language === 'fr' ? 'Sélectionner un agent...' : 'Select agent...',
    nextInQueue: language === 'fr' ? 'Prochain' : 'Next',
    remove: language === 'fr' ? 'Retirer' : 'Remove',
    howItWorks: language === 'fr' ? 'Fonctionnement' : 'How it works',
    howItWorksDesc: language === 'fr' 
      ? 'Les nouveaux chats sont automatiquement assignés à l\'agent disponible suivant dans l\'ordre de priorité (round-robin).'
      : 'New chats are automatically assigned to the next available agent in priority order (round-robin).',
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load routing config
      const routingRes = await supabase
        .from('chat_routing_config')
        .select('*')
        .order('priority_order', { ascending: true });

      if (routingRes.error) throw routingRes.error;
      setEntries(routingRes.data || []);

      // Load all admins from user_roles + profiles for the dropdown
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('role', 'admin');

      if (rolesError) throw rolesError;

      // Get profiles for these admin user_ids
      const adminUserIds = (rolesData || []).map(r => r.user_id);
      let profilesMap: Record<string, { email?: string; full_name?: string; name?: string }> = {};
      
      if (adminUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, email, full_name, name')
          .in('user_id', adminUserIds);
        
        (profiles || []).forEach(p => {
          profilesMap[p.user_id] = p;
        });
      }

      // Build admin users list
      const admins: AdminUser[] = adminUserIds.map(uid => {
        const profile = profilesMap[uid];
        return {
          id: uid,
          email: profile?.email || profile?.full_name || profile?.name || uid.slice(0, 8) + '...',
        };
      });

      setAdminUsers(admins);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const addAgent = async () => {
    if (!selectedAdminToAdd) return;
    const admin = adminUsers.find(a => a.id === selectedAdminToAdd);
    if (!admin) return;

    try {
      const maxOrder = entries.reduce((max, e) => Math.max(max, e.priority_order), 0);
      const { error } = await supabase.from('chat_routing_config').insert({
        admin_user_id: admin.id,
        admin_email: admin.email,
        admin_name: admin.email.split('@')[0],
        priority_order: maxOrder + 1,
        is_available: true,
      });
      if (error) throw error;
      setSelectedAdminToAdd('');
      loadData();
      toast({ title: language === 'fr' ? 'Agent ajouté' : 'Agent added' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const toggleAvailability = async (entry: RoutingEntry) => {
    try {
      const { error } = await supabase
        .from('chat_routing_config')
        .update({ is_available: !entry.is_available })
        .eq('id', entry.id);
      if (error) throw error;
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, is_available: !e.is_available } : e));
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const movePriority = async (entry: RoutingEntry, direction: 'up' | 'down') => {
    const sorted = [...entries].sort((a, b) => a.priority_order - b.priority_order);
    const idx = sorted.findIndex(e => e.id === entry.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const other = sorted[swapIdx];
    try {
      await Promise.all([
        supabase.from('chat_routing_config').update({ priority_order: other.priority_order }).eq('id', entry.id),
        supabase.from('chat_routing_config').update({ priority_order: entry.priority_order }).eq('id', other.id),
      ]);
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const removeAgent = async (id: string) => {
    try {
      const { error } = await supabase.from('chat_routing_config').delete().eq('id', id);
      if (error) throw error;
      loadData();
      toast({ title: language === 'fr' ? 'Agent retiré' : 'Agent removed' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // Find which agent is "next" in the round-robin
  const availableEntries = entries.filter(e => e.is_available).sort((a, b) => a.priority_order - b.priority_order);
  const nextAgent = availableEntries.length > 0
    ? availableEntries.reduce((min, e) => e.chats_assigned_count < min.chats_assigned_count ? e : min, availableEntries[0])
    : null;

  const configuredAdminIds = new Set(entries.map(e => e.admin_user_id));
  const availableAdminsToAdd = adminUsers.filter(a => !configuredAdminIds.has(a.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{txt.title}</h1>
          <p className="text-muted-foreground">{txt.subtitle}</p>
        </div>
        <Button variant="outline" size="icon" onClick={loadData}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* How it works */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 pt-4">
          <Settings2 className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-sm">{txt.howItWorks}</p>
            <p className="text-sm text-muted-foreground">{txt.howItWorksDesc}</p>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              {language === 'fr' ? 'Agents configurés' : 'Configured Agents'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entries.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              {language === 'fr' ? 'Agents disponibles' : 'Available Agents'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {entries.filter(e => e.is_available).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'fr' ? 'Prochain agent' : 'Next Agent'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold truncate">
              {nextAgent ? (nextAgent.admin_name || nextAgent.admin_email || 'Agent') : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Agent */}
      {availableAdminsToAdd.length > 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-4">
            <Select value={selectedAdminToAdd} onValueChange={setSelectedAdminToAdd}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={txt.selectAgent} />
              </SelectTrigger>
              <SelectContent>
                {availableAdminsToAdd.map(admin => (
                  <SelectItem key={admin.id} value={admin.id}>
                    {admin.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addAgent} disabled={!selectedAdminToAdd}>
              <Plus className="h-4 w-4 mr-2" />
              {txt.addAgent}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Agents Table */}
      <Card>
        <CardHeader>
          <CardTitle>{language === 'fr' ? 'File d\'attente des agents' : 'Agent Queue'}</CardTitle>
          <CardDescription>
            {language === 'fr' 
              ? 'Réorganisez les agents par priorité. Le prochain chat sera assigné à l\'agent disponible avec le moins de chats.'
              : 'Reorder agents by priority. Next chat will be assigned to the available agent with fewest chats.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">{txt.noAgents}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{txt.priority}</TableHead>
                  <TableHead>{txt.agent}</TableHead>
                  <TableHead>{txt.available}</TableHead>
                  <TableHead>{txt.assigned}</TableHead>
                  <TableHead>{txt.lastAssigned}</TableHead>
                  <TableHead>{txt.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.sort((a, b) => a.priority_order - b.priority_order).map((entry, idx) => (
                  <TableRow key={entry.id} className={nextAgent?.id === entry.id ? 'bg-primary/5' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm">{idx + 1}</span>
                        <div className="flex flex-col">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={idx === 0}
                            onClick={() => movePriority(entry, 'up')}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={idx === entries.length - 1}
                            onClick={() => movePriority(entry, 'down')}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{entry.admin_name || entry.admin_email?.split('@')[0]}</p>
                        <p className="text-xs text-muted-foreground">{entry.admin_email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={entry.is_available}
                        onCheckedChange={() => toggleAvailability(entry)}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.chats_assigned_count}</Badge>
                    </TableCell>
                    <TableCell>
                      {entry.last_assigned_at
                        ? format(new Date(entry.last_assigned_at), 'MMM d, HH:mm')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {nextAgent?.id === entry.id && (
                          <Badge className="bg-green-600">{txt.nextInQueue}</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeAgent(entry.id)}
                        >
                          {txt.remove}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}