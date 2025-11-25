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
import { Eye, Filter, Trophy, X, FileText, Search, Edit, CheckCircle, Check } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { z } from 'zod';

const submissionEditSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(200, "Name must be less than 200 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be less than 255 characters"),
  whatsapp_number: z.string().trim().min(1, "WhatsApp number is required").max(20, "WhatsApp number must be less than 20 characters"),
  country: z.string().trim().max(100, "Country must be less than 100 characters").optional(),
  city_province: z.string().trim().min(1, "City/Province is required").max(100, "City/Province must be less than 100 characters"),
  project_type: z.string().trim().max(100, "Project type must be less than 100 characters").optional(),
  project_title: z.string().trim().min(1, "Project title is required").max(200, "Project title must be less than 200 characters"),
  project_description: z.string().trim().min(1, "Project description is required").max(1000, "Project description must be less than 1000 characters"),
  funding_needed: z.number().positive("Funding amount must be positive").max(999999999, "Funding amount is too large"),
  payment_phone_number: z.string().trim().max(20, "Payment phone number must be less than 20 characters").optional(),
  payment_reference: z.string().trim().max(100, "Payment reference must be less than 100 characters").optional(),
});

export default function AdminSubmissions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [editSubmission, setEditSubmission] = useState<any>(null);
  const [showFrenchTranslation, setShowFrenchTranslation] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [projectTypeFilter, setProjectTypeFilter] = useState('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const itemsPerPage = 10;

  const { data: submissions } = useQuery({
    queryKey: ['adminSubmissions', statusFilter, cityFilter, countryFilter, projectTypeFilter, paymentStatusFilter],
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

      if (countryFilter !== 'all') {
        query = query.eq('country', countryFilter);
      }

      if (projectTypeFilter !== 'all') {
        query = query.eq('project_type', projectTypeFilter);
      }

      if (paymentStatusFilter !== 'all') {
        query = query.eq('payment_status', paymentStatusFilter as any);
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

  const { data: countries } = useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('country')
        .order('country');
      
      if (error) throw error;
      return [...new Set(data.map(d => d.country).filter(Boolean))];
    },
  });

  const { data: projectTypes } = useQuery({
    queryKey: ['projectTypes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('project_type')
        .order('project_type');
      
      if (error) throw error;
      return [...new Set(data.map(d => d.project_type).filter(Boolean))];
    },
  });

  const updateSubmissionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Map status to proper enum values
      const statusMap: Record<string, string> = {
        'winner': 'selected',
        'shortlisted': 'under_review',
      };
      const finalStatus = statusMap[status] || status;
      
      const updates: any = { 
        submission_status: finalStatus as any,
      };
      
      // Add selection timestamp for selected/winner status
      if (status === 'selected' || status === 'winner') {
        updates.selection_timestamp = new Date().toISOString();
      }
      
      const { error } = await supabase
        .from('user_submissions')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;

      // If marking as winner, also add to winners table
      if (status === 'winner') {
        const { data: submission } = await supabase
          .from('user_submissions')
          .select('*, sessions(id, name)')
          .eq('id', id)
          .single();
        
        if (submission && submission.sessions) {
          // Check if winner already exists
          const { data: existingWinner } = await supabase
            .from('winners')
            .select('id')
            .eq('session_id', submission.session_id)
            .eq('winner_name', submission.full_name)
            .eq('project_name', submission.project_title)
            .single();
          
          if (!existingWinner) {
            await supabase
              .from('winners')
              .insert({
                session_id: submission.session_id,
                winner_name: submission.full_name,
                project_name: submission.project_title,
                country: submission.country || 'Not specified',
                award_amount: submission.funding_needed || 0,
                year: new Date().getFullYear(),
                is_published: false,
              });
          }
        }
      }

      // If marking as not_selected, send feedback email
      if (status === 'not_selected') {
        const { error: emailError } = await supabase.functions.invoke('send-feedback-email', {
          body: { submissionId: id }
        });
        if (emailError) {
          console.error('Failed to send feedback email:', emailError);
          throw new Error('Status updated but feedback email failed to send.');
        }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['adminSubmissions'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      queryClient.invalidateQueries({ queryKey: ['winners'] });
      setSelectedSubmission(null);
      toast({ 
        title: 'Success', 
        description: variables.status === 'not_selected' 
          ? 'Submission marked as not selected. Feedback email sent to applicant.'
          : variables.status === 'winner'
          ? 'Submission marked as winner and added to winners list.'
          : 'Submission status updated'
      });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateSubmissionDetailsMutation = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...updates } = data;
      const { error } = await supabase
        .from('user_submissions')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSubmissions'] });
      setEditSubmission(null);
      toast({ title: 'Success', description: 'Submission details updated' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const verifyPaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('user_submissions')
        .update({ payment_status: 'paid' })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSubmissions'] });
      toast({ title: 'Success', description: 'Payment verified' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      // Map status to proper enum values
      const statusMap: Record<string, string> = {
        'winner': 'selected',
        'shortlisted': 'under_review',
      };
      const finalStatus = statusMap[status] || status;
      
      const updates: any = { 
        submission_status: finalStatus as any,
      };
      
      if (status === 'selected') {
        updates.selection_timestamp = new Date().toISOString();
      }
      
      const { error } = await supabase
        .from('user_submissions')
        .update(updates)
        .in('id', ids);
      
      if (error) throw error;

      // Send feedback emails for not_selected status
      if (status === 'not_selected') {
        await Promise.all(
          ids.map(id =>
            supabase.functions.invoke('send-feedback-email', {
              body: { submissionId: id }
            })
          )
        );
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['adminSubmissions'] });
      queryClient.invalidateQueries({ queryKey: ['adminStats'] });
      setSelectedIds(new Set());
      toast({ 
        title: 'Success', 
        description: `${variables.ids.length} submission(s) updated to ${variables.status}`
      });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedSubmissions?.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedSubmissions?.map(s => s.id) || []));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkAction = (status: string) => {
    if (selectedIds.size === 0) {
      toast({ title: 'No Selection', description: 'Please select submissions first', variant: 'destructive' });
      return;
    }
    bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), status });
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      submitted: { variant: 'secondary', label: 'Submitted' },
      under_review: { variant: 'default', label: 'Under Review' },
      shortlisted: { variant: 'default', label: 'Shortlisted' },
      winner: { variant: 'default', label: 'Winner' },
      not_selected: { variant: 'outline', label: 'Not Selected' },
      selected: { variant: 'default', label: 'Selected' },
    };
    const { variant, label } = config[status] || config.pending;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: 'Pending' },
      paid: { variant: 'default', label: 'Paid' },
      failed: { variant: 'destructive', label: 'Failed' },
    };
    const { variant, label } = config[status] || config.pending;
    return <Badge variant={variant}>{label}</Badge>;
  };

  // Filter and search submissions
  const filteredSubmissions = submissions?.filter(sub => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      sub.full_name?.toLowerCase().includes(query) ||
      sub.email?.toLowerCase().includes(query) ||
      sub.whatsapp_number?.includes(query) ||
      sub.project_title?.toLowerCase().includes(query) ||
      sub.project_code?.toLowerCase().includes(query)
    );
  });

  // Pagination
  const totalPages = Math.ceil((filteredSubmissions?.length || 0) / itemsPerPage);
  const paginatedSubmissions = filteredSubmissions?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      const validatedData = submissionEditSchema.parse({
        full_name: formData.get('full_name'),
        email: formData.get('email'),
        whatsapp_number: formData.get('whatsapp_number'),
        country: formData.get('country') || undefined,
        city_province: formData.get('city_province'),
        project_type: formData.get('project_type') || undefined,
        project_title: formData.get('project_title'),
        project_description: formData.get('project_description'),
        funding_needed: Number(formData.get('funding_needed')),
        payment_phone_number: formData.get('payment_phone_number') || undefined,
        payment_reference: formData.get('payment_reference') || undefined,
      });

      updateSubmissionDetailsMutation.mutate({
        id: editSubmission.id,
        ...validatedData,
        payment_method: formData.get('payment_method') as any,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: 'Validation Error',
          description: error.errors[0].message,
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-2">Submissions Review</h1>
        <p className="text-muted-foreground">Review and evaluate project submissions</p>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, phone, title, or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex gap-2 ml-auto">
              <Badge variant="secondary" className="px-3 py-1">
                {selectedIds.size} selected
              </Badge>
              <Button
                size="sm"
                variant="default"
                onClick={() => handleBulkAction('selected')}
                disabled={bulkUpdateMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve Selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction('not_selected')}
                disabled={bulkUpdateMutation.isPending}
              >
                <X className="h-4 w-4 mr-1" />
                Reject Selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="shortlisted">Shortlisted</SelectItem>
                <SelectItem value="winner">Winner</SelectItem>
                <SelectItem value="not_selected">Not Selected</SelectItem>
                <SelectItem value="selected">Selected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Payment status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payment Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countries?.map((country) => (
                <SelectItem key={country} value={country}>{country}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

          <Select value={projectTypeFilter} onValueChange={setProjectTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Project type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Project Types</SelectItem>
              {projectTypes?.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto text-sm text-muted-foreground">
            {filteredSubmissions?.length || 0} submissions
          </div>
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
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === paginatedSubmissions?.length && paginatedSubmissions.length > 0}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSubmissions?.map((submission) => (
                <TableRow key={submission.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(submission.id)}
                      onChange={() => toggleSelect(submission.id)}
                      className="cursor-pointer"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{submission.full_name}</div>
                    <div className="text-xs text-muted-foreground">{submission.project_code || 'N/A'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{submission.email}</div>
                    <div className="text-xs text-muted-foreground">{submission.whatsapp_number}</div>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="font-medium truncate">{submission.project_title}</div>
                    <div className="text-xs text-muted-foreground">
                      ${String(submission.funding_needed).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      {submission.category && <span className="ml-2">• {submission.category}</span>}
                    </div>
                    {submission.ai_overall_score && (
                      <div className="text-xs font-semibold text-primary mt-1">
                        Score: {submission.ai_overall_score}/10
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{submission.country}</div>
                    <div className="text-xs text-muted-foreground">{submission.city_province}</div>
                  </TableCell>
                  <TableCell>{submission.project_type || 'N/A'}</TableCell>
                  <TableCell>{getStatusBadge(submission.submission_status)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {getPaymentStatusBadge(submission.payment_status)}
                      {submission.payment_status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => verifyPaymentMutation.mutate(submission.id)}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Verify
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => setSelectedSubmission(submission)}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl glass-strong max-h-[90vh] flex flex-col">
                          <DialogHeader className="flex-shrink-0">
                            <DialogTitle className="flex items-center gap-2">
                              <FileText className="h-5 w-5" />
                              Judge Dashboard: {submission.project_title}
                            </DialogTitle>
                            <DialogDescription>
                              Code: {submission.project_code || 'Pending payment'} | 
                              Language: {submission.language_detected || 'N/A'} | 
                              Category: {submission.category || 'N/A'}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-6 overflow-y-auto flex-1 pr-2">
                            {/* AI Scores Section */}
                            {submission.ai_overall_score && (
                              <div className="grid grid-cols-3 gap-4 p-4 bg-primary/10 rounded-lg">
                                <div className="text-center">
                                  <Label className="text-xs text-muted-foreground">Overall Score</Label>
                                  <p className="text-3xl font-bold text-primary">{submission.ai_overall_score}/10</p>
                                </div>
                                <div className="text-center">
                                  <Label className="text-xs text-muted-foreground">Impact Score</Label>
                                  <p className="text-3xl font-bold">{submission.ai_impact_score}/10</p>
                                </div>
                                <div className="text-center">
                                  <Label className="text-xs text-muted-foreground">Feasibility Score</Label>
                                  <p className="text-3xl font-bold">{submission.ai_feasibility_score}/10</p>
                                </div>
                              </div>
                            )}

                            {/* Fraud Flags */}
                            {(submission.is_suspected_fraud || submission.is_possible_duplicate) && (
                              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                                <Label className="text-destructive font-semibold">⚠️ Security Alerts</Label>
                                {submission.is_suspected_fraud && (
                                  <p className="text-sm mt-2">🚨 Suspected Fraud</p>
                                )}
                                {submission.is_possible_duplicate && (
                                  <p className="text-sm mt-1">📋 Possible Duplicate</p>
                                )}
                                {submission.fraud_flags && (
                                  <p className="text-sm mt-2 text-muted-foreground">{submission.fraud_flags}</p>
                                )}
                              </div>
                            )}

                            {/* AI Summary with Translation Toggle */}
                            {submission.ai_summary && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-muted-foreground">AI Summary</Label>
                                  {submission.ai_translation_fr && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setShowFrenchTranslation(!showFrenchTranslation)}
                                    >
                                      {showFrenchTranslation ? 'Show English' : 'Traduire en Français'}
                                    </Button>
                                  )}
                                </div>
                                <p className="text-sm p-3 bg-muted/50 rounded-lg">
                                  {showFrenchTranslation && submission.ai_translation_fr 
                                    ? submission.ai_translation_fr 
                                    : submission.ai_summary}
                                </p>
                              </div>
                            )}

                            {/* AI Strengths */}
                            {submission.ai_strengths && (
                              <div>
                                <Label className="text-green-600 dark:text-green-400">✓ Key Strengths</Label>
                                <div className="text-sm mt-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg whitespace-pre-line">
                                  {submission.ai_strengths}
                                </div>
                              </div>
                            )}

                            {/* AI Risks */}
                            {submission.ai_risks && (
                              <div>
                                <Label className="text-amber-600 dark:text-amber-400">⚠ Key Risks</Label>
                                <div className="text-sm mt-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg whitespace-pre-line">
                                  {submission.ai_risks}
                                </div>
                              </div>
                            )}

                            <div className="border-t pt-4">
                              <Label className="text-muted-foreground">Applicant Information</Label>
                              <div className="grid grid-cols-2 gap-4 mt-2">
                                <div>
                                  <p className="text-xs text-muted-foreground">Name</p>
                                  <p className="font-semibold">{submission.full_name}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Location</p>
                                  <p className="font-semibold">{submission.city_province}, {submission.country}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Email</p>
                                  <p className="text-sm">{submission.email}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">WhatsApp</p>
                                  <p className="text-sm">{submission.whatsapp_number}</p>
                                </div>
                                {submission.project_type && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Project Type</p>
                                    <p className="text-sm">{submission.project_type}</p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div>
                              <Label className="text-muted-foreground">Project Description (Original)</Label>
                              <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg whitespace-pre-line">{submission.project_description}</p>
                            </div>

                            {submission.feasibility_explanation && (
                              <div>
                                <Label className="text-muted-foreground">Feasibility Explanation</Label>
                                <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg whitespace-pre-line">{submission.feasibility_explanation}</p>
                              </div>
                            )}

                            {submission.problem_to_solve && (
                              <div>
                                <Label className="text-muted-foreground">Problem to Solve</Label>
                                <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg whitespace-pre-line">{submission.problem_to_solve}</p>
                              </div>
                            )}

                            {submission.target_audience && (
                              <div>
                                <Label className="text-muted-foreground">Target Audience</Label>
                                <p className="text-sm mt-1 p-3 bg-muted/50 rounded-lg whitespace-pre-line">{submission.target_audience}</p>
                              </div>
                            )}

                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <Label className="text-muted-foreground">Funding Needed</Label>
                                <p className="font-bold text-primary">${submission.funding_needed.toLocaleString()}</p>
                              </div>
                              <div>
                                <Label className="text-muted-foreground">Est. Revenue</Label>
                                <p className="font-semibold">${Number(submission.estimated_monthly_revenue).toLocaleString()}/mo</p>
                              </div>
                              <div>
                                <Label className="text-muted-foreground">Time to Profit</Label>
                                <p className="font-semibold">{submission.time_until_profit}</p>
                              </div>
                            </div>

                            {submission.will_hire && (
                              <div className="p-4 bg-info/10 rounded-lg">
                                <Label className="text-info">👥 Hiring Plans</Label>
                                <p className="text-sm mt-1">
                                  Plans to hire {submission.number_of_hires || 'staff'}
                                </p>
                              </div>
                            )}

                            <div className="border-t pt-4 space-y-3">
                              <Label>Judge Actions</Label>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => updateSubmissionMutation.mutate({ id: submission.id, status: 'under_review' })}
                                  disabled={updateSubmissionMutation.isPending}
                                >
                                  Mark Under Review
                                </Button>
                                <Button
                                  variant="default"
                                  onClick={() => updateSubmissionMutation.mutate({ id: submission.id, status: 'shortlisted' })}
                                  disabled={updateSubmissionMutation.isPending}
                                >
                                  📋 Shortlist
                                </Button>
                                <Button
                                  variant="default"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => updateSubmissionMutation.mutate({ id: submission.id, status: 'winner' })}
                                  disabled={updateSubmissionMutation.isPending}
                                >
                                  <Trophy className="h-4 w-4 mr-2" />
                                  Mark as Winner
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    if (confirm('This will send a feedback email to the applicant. Continue?')) {
                                      updateSubmissionMutation.mutate({ id: submission.id, status: 'not_selected' });
                                    }
                                  }}
                                  disabled={updateSubmissionMutation.isPending}
                                >
                                  <X className="h-4 w-4 mr-2" />
                                  Mark Not Selected (Sends Email)
                                </Button>
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>

                      <Dialog open={editSubmission?.id === submission.id} onOpenChange={(open) => !open && setEditSubmission(null)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => setEditSubmission(submission)}>
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Edit Submission</DialogTitle>
                            <DialogDescription>Update applicant details and submission information</DialogDescription>
                          </DialogHeader>
                          {editSubmission && (
                            <form onSubmit={handleEditSubmit} className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="full_name">Full Name</Label>
                                  <Input id="full_name" name="full_name" defaultValue={editSubmission.full_name} required maxLength={200} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="email">Email</Label>
                                  <Input id="email" name="email" type="email" defaultValue={editSubmission.email} required maxLength={255} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="whatsapp_number">WhatsApp Number</Label>
                                  <Input id="whatsapp_number" name="whatsapp_number" defaultValue={editSubmission.whatsapp_number} required maxLength={20} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="country">Country</Label>
                                  <Input id="country" name="country" defaultValue={editSubmission.country || ''} maxLength={100} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="city_province">City/Province</Label>
                                  <Input id="city_province" name="city_province" defaultValue={editSubmission.city_province} required maxLength={100} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="project_type">Project Type</Label>
                                  <Input id="project_type" name="project_type" defaultValue={editSubmission.project_type || ''} maxLength={100} />
                                </div>
                                <div className="col-span-2 space-y-2">
                                  <Label htmlFor="project_title">Project Title</Label>
                                  <Input id="project_title" name="project_title" defaultValue={editSubmission.project_title} required maxLength={200} />
                                </div>
                                <div className="col-span-2 space-y-2">
                                  <Label htmlFor="project_description">Project Description</Label>
                                  <Textarea id="project_description" name="project_description" defaultValue={editSubmission.project_description} rows={4} required maxLength={1000} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="funding_needed">Funding Needed ($)</Label>
                                  <Input id="funding_needed" name="funding_needed" type="number" defaultValue={editSubmission.funding_needed} required min="1" max="999999999" />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="payment_method">Payment Method</Label>
                                  <Select name="payment_method" defaultValue={editSubmission.payment_method || ''}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select method" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="airtel_money">Airtel Money</SelectItem>
                                      <SelectItem value="m_pesa">M-Pesa</SelectItem>
                                      <SelectItem value="orange_money">Orange Money</SelectItem>
                                      <SelectItem value="afrimoney">Afrimoney</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="payment_phone_number">Payment Phone Number</Label>
                                  <Input id="payment_phone_number" name="payment_phone_number" defaultValue={editSubmission.payment_phone_number || ''} maxLength={20} />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="payment_reference">Payment Reference</Label>
                                  <Input id="payment_reference" name="payment_reference" defaultValue={editSubmission.payment_reference || ''} maxLength={100} />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setEditSubmission(null)}>Cancel</Button>
                                <Button type="submit">Save Changes</Button>
                              </div>
                            </form>
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      href="#" 
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage > 1) setCurrentPage(currentPage - 1);
                      }}
                    />
                  </PaginationItem>
                  {[...Array(totalPages)].map((_, i) => (
                    <PaginationItem key={i}>
                      <PaginationLink
                        href="#"
                        isActive={currentPage === i + 1}
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrentPage(i + 1);
                        }}
                      >
                        {i + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext 
                      href="#" 
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
