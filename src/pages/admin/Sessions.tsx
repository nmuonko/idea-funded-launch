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
import { Plus, Edit, Users, Calendar, TrendingUp, Target, CheckCircle, Trash2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';

const sessionSchema = z.object({
  name: z.string()
    .trim()
    .min(1, { message: "Session name is required" })
    .max(100, { message: "Session name must be less than 100 characters" }),
  targetApplicants: z.number().min(10, "Must be at least 10").max(10000, "Cannot exceed 10,000"),
  desiredMaxParticipants: z.number().min(10).max(10000),
  deadlineDatetime: z.string().optional(),
  isActive: z.boolean().default(false),
});

export default function AdminSessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [reviewProgress, setReviewProgress] = useState(0);
  const [winnerForm, setWinnerForm] = useState({
    winner_name: '',
    project_name: '',
    country: '',
    award_amount: '',
  });

  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      name: '',
      targetApplicants: 500,
      desiredMaxParticipants: 100,
      deadlineDatetime: '',
      isActive: false,
    },
  });

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

  const { data: winners, refetch: refetchWinners } = useQuery({
    queryKey: ['winners', selectedSession?.id],
    queryFn: async () => {
      if (!selectedSession) return [];
      const { data, error } = await supabase
        .from('winners')
        .select('*')
        .eq('session_id', selectedSession.id)
        .order('display_order');
      
      if (error) throw error;
      return data;
    },
    enabled: !!selectedSession,
  });

  const createSessionMutation = useMutation({
    mutationFn: async (values: z.infer<typeof sessionSchema>) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          name: values.name,
          desired_max_participants: values.desiredMaxParticipants,
          target_applicants: values.targetApplicants,
          deadline_datetime: values.deadlineDatetime || null,
          is_active: values.isActive,
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
      form.reset();
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

  const onSubmit = (values: z.infer<typeof sessionSchema>) => {
    createSessionMutation.mutate(values);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      open: 'default',
      closed: 'secondary',
      results_published: 'outline',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  const handleUpdateReviewProgress = (sessionId: string, progress: number) => {
    updateSessionMutation.mutate({
      id: sessionId,
      updates: { review_progress: progress },
    });
  };

  const handlePublishResults = (sessionId: string) => {
    updateSessionMutation.mutate({
      id: sessionId,
      updates: { status: 'results_published' },
    });
  };

  const handleToggleActive = async (sessionId: string, currentStatus: boolean) => {
    if (!currentStatus) {
      // If activating this session, deactivate all others first
      const { error: deactivateError } = await supabase
        .from('sessions')
        .update({ is_active: false })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (deactivateError) {
        toast({ title: 'Error', description: 'Failed to deactivate other sessions', variant: 'destructive' });
        return;
      }
    }
    
    updateSessionMutation.mutate({
      id: sessionId,
      updates: { is_active: !currentStatus },
    });
  };

  const handleUpdateSettings = (sessionId: string, updates: any) => {
    updateSessionMutation.mutate({
      id: sessionId,
      updates,
    });
  };

  const handleAddWinner = async () => {
    if (!selectedSession || !winnerForm.winner_name || !winnerForm.project_name || !winnerForm.country || !winnerForm.award_amount) {
      toast({ title: 'Error', description: 'Please fill all winner fields', variant: 'destructive' });
      return;
    }

    const { error } = await supabase
      .from('winners')
      .insert({
        session_id: selectedSession.id,
        winner_name: winnerForm.winner_name,
        project_name: winnerForm.project_name,
        country: winnerForm.country,
        award_amount: parseFloat(winnerForm.award_amount),
        year: new Date().getFullYear(),
        is_published: false,
        display_order: (winners?.length || 0) + 1,
      });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Winner added successfully' });
      setWinnerForm({ winner_name: '', project_name: '', country: '', award_amount: '' });
      refetchWinners();
    }
  };

  const handleDeleteWinner = async (winnerId: string) => {
    const { error } = await supabase
      .from('winners')
      .delete()
      .eq('id', winnerId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Winner deleted successfully' });
      refetchWinners();
    }
  };

  const handleToggleWinnerPublish = async (winnerId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('winners')
      .update({ is_published: !currentStatus })
      .eq('id', winnerId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: `Winner ${!currentStatus ? 'published' : 'unpublished'} successfully` });
      refetchWinners();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Session Management</h1>
          <p className="text-muted-foreground">Configure competition sessions, targets, and deadlines</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Session
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Session</DialogTitle>
              <DialogDescription>Set up a new competition session with custom parameters</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Session Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Session 1 - 2025" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="targetApplicants"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Applicants (for progress bar)</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Input 
                            type="number" 
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                          <Slider
                            min={10}
                            max={5000}
                            step={10}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                          />
                        </div>
                      </FormControl>
                      <FormDescription>
                        This number will be displayed on the public results page
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="desiredMaxParticipants"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Participants (hard limit)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormDescription>
                        Applications will be blocked once this limit is reached
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deadlineDatetime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Application Deadline</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormDescription>
                        Countdown timer will be displayed on the results page
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Set as Active Session</FormLabel>
                        <FormDescription>
                          Make this the current active session (will deactivate others)
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSessionMutation.isPending}>
                    Create Session
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessions?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sessions?.filter((s: any) => s.is_active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Participants</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sessions && sessions.length > 0
                ? Math.round(sessions.reduce((sum: number, s: any) => sum + s.current_participant_count, 0) / sessions.length)
                : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Sessions</CardTitle>
          <CardDescription>Manage your competition sessions and their settings</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Participants</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions?.map((session: any) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.name}</TableCell>
                  <TableCell>{getStatusBadge(session.status)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={session.is_active}
                      onCheckedChange={() => handleToggleActive(session.id, session.is_active)}
                    />
                  </TableCell>
                  <TableCell>{session.current_participant_count}</TableCell>
                  <TableCell>{session.target_applicants || 'N/A'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={
                          session.target_applicants > 0
                            ? (session.current_participant_count / session.target_applicants) * 100
                            : 0
                        } 
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">
                        {session.target_applicants > 0
                          ? `${Math.round((session.current_participant_count / session.target_applicants) * 100)}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {session.deadline_datetime 
                      ? new Date(session.deadline_datetime).toLocaleDateString()
                      : 'Not set'}
                  </TableCell>
                   <TableCell>
                     <Dialog onOpenChange={(open) => open && setSelectedSession(session)}>
                       <DialogTrigger asChild>
                         <Button variant="ghost" size="sm">
                           <Edit className="h-4 w-4" />
                         </Button>
                       </DialogTrigger>
                       <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                         <DialogHeader>
                           <DialogTitle>Edit Session: {session.name}</DialogTitle>
                           <DialogDescription>Update session settings, review progress, and manage winners</DialogDescription>
                         </DialogHeader>
                         <div className="space-y-6">
                           {/* Session Settings */}
                           <div className="space-y-4">
                             <h3 className="text-lg font-semibold">Session Settings</h3>
                             <div className="space-y-2">
                               <Label>Target Applicants</Label>
                               <Input 
                                 type="number"
                                 defaultValue={session.target_applicants}
                                 onChange={(e) => {
                                   const value = parseInt(e.target.value);
                                   if (!isNaN(value)) {
                                     handleUpdateSettings(session.id, { target_applicants: value });
                                   }
                                 }}
                               />
                             </div>
                             <div className="space-y-2">
                               <Label>Deadline</Label>
                               <Input 
                                 type="datetime-local"
                                 defaultValue={session.deadline_datetime ? new Date(session.deadline_datetime).toISOString().slice(0, 16) : ''}
                                 onChange={(e) => {
                                   handleUpdateSettings(session.id, { deadline_datetime: e.target.value || null });
                                 }}
                               />
                             </div>
                             <div className="space-y-2">
                               <Label>Review Progress: {session.review_progress}%</Label>
                               <Slider
                                 value={[session.review_progress]}
                                 onValueChange={(value) => handleUpdateReviewProgress(session.id, value[0])}
                                 max={100}
                                 step={1}
                               />
                             </div>
                             {session.review_progress >= 100 && session.status !== 'results_published' && (
                               <Button 
                                 onClick={() => handlePublishResults(session.id)}
                                 className="w-full"
                               >
                                 Publish Results
                               </Button>
                             )}
                           </div>

                           {/* Winner Management */}
                           <div className="space-y-4 border-t pt-6">
                             <h3 className="text-lg font-semibold">Winner Management</h3>
                             
                             {/* Add Winner Form */}
                             <Card>
                               <CardHeader>
                                 <CardTitle className="text-base">Add New Winner</CardTitle>
                               </CardHeader>
                               <CardContent className="space-y-4">
                                 <div className="grid grid-cols-2 gap-4">
                                   <div className="space-y-2">
                                     <Label>Full Name</Label>
                                     <Input 
                                       value={winnerForm.winner_name}
                                       onChange={(e) => setWinnerForm({...winnerForm, winner_name: e.target.value})}
                                       placeholder="John Doe"
                                     />
                                   </div>
                                   <div className="space-y-2">
                                     <Label>Project / Business Name</Label>
                                     <Input 
                                       value={winnerForm.project_name}
                                       onChange={(e) => setWinnerForm({...winnerForm, project_name: e.target.value})}
                                       placeholder="EcoFarm Solutions"
                                     />
                                   </div>
                                   <div className="space-y-2">
                                     <Label>Country</Label>
                                     <Input 
                                       value={winnerForm.country}
                                       onChange={(e) => setWinnerForm({...winnerForm, country: e.target.value})}
                                       placeholder="DRC"
                                     />
                                   </div>
                                   <div className="space-y-2">
                                     <Label>Award Amount (USD)</Label>
                                     <Input 
                                       type="number"
                                       value={winnerForm.award_amount}
                                       onChange={(e) => setWinnerForm({...winnerForm, award_amount: e.target.value})}
                                       placeholder="5000"
                                     />
                                   </div>
                                 </div>
                                 <Button onClick={handleAddWinner} className="w-full">
                                   <Plus className="h-4 w-4 mr-2" />
                                   Add Winner
                                 </Button>
                               </CardContent>
                             </Card>

                             {/* Winners List */}
                             {winners && winners.length > 0 && (
                               <Card>
                                 <CardHeader>
                                   <CardTitle className="text-base">Current Winners</CardTitle>
                                 </CardHeader>
                                 <CardContent>
                                   <Table>
                                     <TableHeader>
                                       <TableRow>
                                         <TableHead>Name</TableHead>
                                         <TableHead>Project</TableHead>
                                         <TableHead>Country</TableHead>
                                         <TableHead>Award</TableHead>
                                         <TableHead>Published</TableHead>
                                         <TableHead>Actions</TableHead>
                                       </TableRow>
                                     </TableHeader>
                                     <TableBody>
                                       {winners.map((winner: any) => (
                                         <TableRow key={winner.id}>
                                           <TableCell>{winner.winner_name}</TableCell>
                                           <TableCell>{winner.project_name}</TableCell>
                                           <TableCell>{winner.country}</TableCell>
                                           <TableCell>${winner.award_amount?.toLocaleString()}</TableCell>
                                           <TableCell>
                                             <Switch
                                               checked={winner.is_published}
                                               onCheckedChange={() => handleToggleWinnerPublish(winner.id, winner.is_published)}
                                             />
                                           </TableCell>
                                           <TableCell>
                                             <Button 
                                               variant="ghost" 
                                               size="sm"
                                               onClick={() => handleDeleteWinner(winner.id)}
                                             >
                                               <Trash2 className="h-4 w-4 text-destructive" />
                                             </Button>
                                           </TableCell>
                                         </TableRow>
                                       ))}
                                     </TableBody>
                                   </Table>
                                 </CardContent>
                               </Card>
                             )}
                           </div>
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
