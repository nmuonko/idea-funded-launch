import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Filter, Trophy, X, FileText } from 'lucide-react';
import { Label } from '@/components/ui/label';

export default function AdminSubmissions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');

  const { data: submissions } = useQuery({
    queryKey: ['adminSubmissions', statusFilter, cityFilter],
    queryFn: async () => {
      let query = supabase
        .from('user_submissions')
        .select('*, sessions(name, status)')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('submission_status', statusFilter as any);
      }
      
      if (cityFilter !== 'all') {
        query = query.eq('city_province', cityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('city_province')
        .order('city_province');
      
      if (error) throw error;
      return [...new Set(data.map(d => d.city_province))];
    },
  });

  const updateSubmissionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('user_submissions')
        .update({ 
          submission_status: status as any,
          ...(status === 'selected' ? { selection_timestamp: new Date().toISOString() } : {}),
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSubmissions'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      setSelectedSubmission(null);
      toast({ title: 'Success', description: 'Submission status updated' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      under_review: { variant: 'default', label: 'Under Review' },
      not_selected: { variant: 'outline', label: 'Not Selected' },
      selected: { variant: 'default', label: 'Selected' },
    };
    const { variant, label } = config[status] || config.pending;
    return <Badge variant={variant}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-2">Submissions Review</h1>
        <p className="text-muted-foreground">Review and evaluate project submissions</p>
      </div>

      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="not_selected">Not Selected</SelectItem>
              <SelectItem value="selected">Selected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by city" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cities</SelectItem>
            {cities?.map((city) => (
              <SelectItem key={city} value={city}>{city}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto text-sm text-muted-foreground">
          {submissions?.length || 0} submissions
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">
              {submissions?.filter(s => s.submission_status === 'pending').length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Under Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info">
              {submissions?.filter(s => s.submission_status === 'under_review').length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Not Selected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">
              {submissions?.filter(s => s.submission_status === 'not_selected').length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Winners</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {submissions?.filter(s => s.submission_status === 'selected').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-strong">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Funding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions?.map((submission) => (
                <TableRow key={submission.id}>
                  <TableCell className="font-mono text-sm">{submission.project_code || 'N/A'}</TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">{submission.project_title}</TableCell>
                  <TableCell>{submission.city_province}</TableCell>
                  <TableCell>${Number(submission.funding_needed).toLocaleString()}</TableCell>
                  <TableCell>{getStatusBadge(submission.submission_status)}</TableCell>
                  <TableCell>{submission.sessions?.name}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => setSelectedSubmission(submission)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl glass-strong max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Submission Details
                          </DialogTitle>
                          <DialogDescription>Code: {submission.project_code || 'Pending payment'}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label className="text-muted-foreground">Project Title</Label>
                              <p className="font-semibold">{submission.project_title}</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">City/Province</Label>
                              <p className="font-semibold">{submission.city_province}</p>
                            </div>
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Project Description</Label>
                            <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg">{submission.project_description}</p>
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Feasibility Explanation</Label>
                            <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg">{submission.feasibility_explanation}</p>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <Label className="text-muted-foreground">Funding Needed</Label>
                              <p className="font-bold text-primary">${submission.funding_needed.toLocaleString()}</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Est. Revenue</Label>
                              <p className="font-semibold">${parseFloat(submission.estimated_monthly_revenue).toLocaleString()}/mo</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Time to Profit</Label>
                              <p className="font-semibold">{submission.time_until_profit}</p>
                            </div>
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Will Hire?</Label>
                            <p className="font-semibold">
                              {submission.will_hire ? `Yes (${submission.number_of_hires} people)` : 'No'}
                            </p>
                          </div>

                          <div className="border-t pt-4 space-y-2">
                            <Label>Update Status</Label>
                            <div className="flex gap-2">
                              <Button 
                                onClick={() => updateSubmissionMutation.mutate({ 
                                  id: submission.id, 
                                  status: 'under_review' 
                                })}
                                variant="outline"
                                size="sm"
                                className="flex-1"
                              >
                                Under Review
                              </Button>
                              <Button 
                                onClick={() => updateSubmissionMutation.mutate({ 
                                  id: submission.id, 
                                  status: 'selected' 
                                })}
                                variant="default"
                                size="sm"
                                className="flex-1"
                              >
                                <Trophy className="h-4 w-4 mr-1" />
                                Select as Winner
                              </Button>
                              <Button 
                                onClick={() => updateSubmissionMutation.mutate({ 
                                  id: submission.id, 
                                  status: 'not_selected' 
                                })}
                                variant="outline"
                                size="sm"
                                className="flex-1"
                              >
                                <X className="h-4 w-4 mr-1" />
                                Not Selected
                              </Button>
                            </div>
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
