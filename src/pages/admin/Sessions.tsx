import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Users, Calendar, TrendingUp } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

export default function AdminSessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [newSession, setNewSession] = useState({
    name: '',
    desiredMaxParticipants: 100,
  });
  const [reviewProgress, setReviewProgress] = useState(0);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['adminSessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          name: newSession.name,
          desired_max_participants: newSession.desiredMaxParticipants,
          status: 'open',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSessions'] });
      setIsCreateOpen(false);
      setNewSession({ name: '', desiredMaxParticipants: 100 });
      toast({ title: 'Success', description: 'Session created successfully' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from('sessions')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSessions'] });
      setSelectedSession(null);
      toast({ title: 'Success', description: 'Session updated successfully' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
      open: 'default',
      closed: 'secondary',
      results_published: 'outline',
    };
    return <Badge variant={variants[status] || 'default'}>{status.replace('_', ' ').toUpperCase()}</Badge>;
  };

  const handleUpdateReviewProgress = () => {
    if (!selectedSession) return;
    updateSessionMutation.mutate({
      id: selectedSession.id,
      updates: { review_progress: reviewProgress },
    });
  };

  const handlePublishResults = () => {
    if (!selectedSession) return;
    updateSessionMutation.mutate({
      id: selectedSession.id,
      updates: { 
        status: 'results_published',
        announcement_date: new Date().toISOString(),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold mb-2">Sessions Management</h1>
          <p className="text-muted-foreground">Create and manage competition sessions</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-strong">
            <DialogHeader>
              <DialogTitle>Create New Session</DialogTitle>
              <DialogDescription>Set up a new competition session</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Session Name</Label>
                <Input
                  placeholder="e.g., Session Q1 2025"
                  value={newSession.name}
                  onChange={(e) => setNewSession({ ...newSession, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Participants: {newSession.desiredMaxParticipants}</Label>
                <Slider
                  value={[newSession.desiredMaxParticipants]}
                  onValueChange={([value]) => setNewSession({ ...newSession, desiredMaxParticipants: value })}
                  min={10}
                  max={500}
                  step={10}
                />
              </div>
              <Button 
                onClick={() => createSessionMutation.mutate()} 
                disabled={!newSession.name || createSessionMutation.isPending}
                className="w-full"
              >
                Create Session
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {sessions?.filter(s => s.status === 'open').length || 0}
            </div>
          </CardContent>
        </Card>
        
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-secondary" />
              Total Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-secondary">
              {sessions?.length || 0}
            </div>
          </CardContent>
        </Card>
        
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              Avg Participants
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-success">
              {sessions?.length 
                ? Math.round(sessions.reduce((sum, s) => sum + s.current_participant_count, 0) / sessions.length)
                : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-strong">
        <CardHeader>
          <CardTitle>All Sessions</CardTitle>
          <CardDescription>Manage existing competition sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Participants</TableHead>
                <TableHead>Review Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions?.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.name}</TableCell>
                  <TableCell>{getStatusBadge(session.status)}</TableCell>
                  <TableCell>
                    {session.current_participant_count} / {session.desired_max_participants}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={session.review_progress} className="w-20" />
                      <span className="text-sm text-muted-foreground">{session.review_progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell>{new Date(session.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setSelectedSession(session);
                            setReviewProgress(session.review_progress);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="glass-strong">
                        <DialogHeader>
                          <DialogTitle>Manage Session: {session.name}</DialogTitle>
                          <DialogDescription>Update session settings and progress</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label>Review Progress: {reviewProgress}%</Label>
                            <Slider
                              value={[reviewProgress]}
                              onValueChange={([value]) => setReviewProgress(value)}
                              max={100}
                              step={5}
                              className="mt-2"
                            />
                          </div>
                          <Button onClick={handleUpdateReviewProgress} className="w-full">
                            Update Progress
                          </Button>
                          {session.status === 'closed' && (
                            <Button 
                              onClick={handlePublishResults} 
                              variant="secondary"
                              className="w-full"
                            >
                              Publish Results
                            </Button>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
