import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Mail, Phone, Copy, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function FraudReview() {
  const queryClient = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  const { data: fraudSubmissions, isLoading } = useQuery({
    queryKey: ['fraudSubmissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('*')
        .or('is_suspected_fraud.eq.true,is_possible_duplicate.eq.true')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Categorize submissions by fraud type
      const duplicateEmails = data?.filter(s => 
        s.fraud_flags?.toLowerCase().includes('duplicate email')
      ) || [];
      
      const duplicatePhones = data?.filter(s => 
        s.fraud_flags?.toLowerCase().includes('duplicate phone')
      ) || [];
      
      const plagiarism = data?.filter(s => 
        s.fraud_flags?.toLowerCase().includes('ai detected') || 
        s.fraud_flags?.toLowerCase().includes('similar content')
      ) || [];
      
      const multipleSubmissions = data?.filter(s => 
        s.fraud_flags?.toLowerCase().includes('multiple submissions')
      ) || [];

      return {
        all: data || [],
        duplicateEmails,
        duplicatePhones,
        plagiarism,
        multipleSubmissions,
      };
    },
  });

  const markAsReviewedMutation = useMutation({
    mutationFn: async ({ id, isLegit }: { id: string; isLegit: boolean }) => {
      const { error } = await supabase
        .from('user_submissions')
        .update({
          is_suspected_fraud: isLegit ? false : true,
          is_possible_duplicate: false,
          submission_status: isLegit ? 'under_review' : 'not_selected',
          fraud_flags: isLegit ? null : '[CONFIRMED] ' + (selectedSubmission?.fraud_flags || 'Fraud confirmed by admin'),
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fraudSubmissions'] });
      toast.success('Submission reviewed successfully');
      setDetailsDialogOpen(false);
    },
    onError: (error) => {
      toast.error('Failed to update submission: ' + error.message);
    },
  });

  const viewDetails = (submission: any) => {
    setSelectedSubmission(submission);
    setDetailsDialogOpen(true);
  };

  const SubmissionTable = ({ submissions, title }: { submissions: any[]; title: string }) => (
    <Card className="glass-strong">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          {title}
          <Badge variant="destructive" className="ml-auto">{submissions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Confirmation ID</TableHead>
              <TableHead>Applicant</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Fraud Flags</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No flagged submissions in this category
                </TableCell>
              </TableRow>
            ) : (
              submissions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono text-sm">{sub.confirmation_id}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{sub.full_name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {sub.email}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {sub.whatsapp_number}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xs">
                      <div className="font-medium truncate">{sub.project_title}</div>
                      <div className="text-xs text-muted-foreground">{sub.category}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-sm text-xs text-warning space-y-1">
                      {sub.fraud_flags?.split('|').map((flag: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span>{flag.trim()}</span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={sub.ai_overall_score >= 70 ? 'default' : 'secondary'}>
                      {sub.ai_overall_score || 'N/A'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewDetails(sub)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-2">Fraud Review Queue</h1>
        <p className="text-muted-foreground text-lg">
          Review and manage flagged submissions across different fraud categories
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass border-warning/20">
          <CardHeader className="pb-3">
            <CardDescription>Total Flagged</CardDescription>
            <CardTitle className="text-3xl font-bold text-warning">
              {fraudSubmissions?.all.length || 0}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="glass border-destructive/20">
          <CardHeader className="pb-3">
            <CardDescription>Duplicate Emails</CardDescription>
            <CardTitle className="text-3xl font-bold text-destructive">
              {fraudSubmissions?.duplicateEmails.length || 0}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="glass border-destructive/20">
          <CardHeader className="pb-3">
            <CardDescription>Duplicate Phones</CardDescription>
            <CardTitle className="text-3xl font-bold text-destructive">
              {fraudSubmissions?.duplicatePhones.length || 0}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="glass border-warning/20">
          <CardHeader className="pb-3">
            <CardDescription>Plagiarism Detected</CardDescription>
            <CardTitle className="text-3xl font-bold text-warning">
              {fraudSubmissions?.plagiarism.length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all">All ({fraudSubmissions?.all.length || 0})</TabsTrigger>
          <TabsTrigger value="emails">
            Duplicate Emails ({fraudSubmissions?.duplicateEmails.length || 0})
          </TabsTrigger>
          <TabsTrigger value="phones">
            Duplicate Phones ({fraudSubmissions?.duplicatePhones.length || 0})
          </TabsTrigger>
          <TabsTrigger value="plagiarism">
            Plagiarism ({fraudSubmissions?.plagiarism.length || 0})
          </TabsTrigger>
          <TabsTrigger value="multiple">
            Multiple ({fraudSubmissions?.multipleSubmissions.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <SubmissionTable submissions={fraudSubmissions?.all || []} title="All Flagged Submissions" />
        </TabsContent>

        <TabsContent value="emails">
          <SubmissionTable submissions={fraudSubmissions?.duplicateEmails || []} title="Duplicate Email Submissions" />
        </TabsContent>

        <TabsContent value="phones">
          <SubmissionTable submissions={fraudSubmissions?.duplicatePhones || []} title="Duplicate Phone Submissions" />
        </TabsContent>

        <TabsContent value="plagiarism">
          <SubmissionTable submissions={fraudSubmissions?.plagiarism || []} title="Plagiarism Detected" />
        </TabsContent>

        <TabsContent value="multiple">
          <SubmissionTable submissions={fraudSubmissions?.multipleSubmissions || []} title="Multiple Submissions" />
        </TabsContent>
      </Tabs>

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Submission: {selectedSubmission?.confirmation_id}</DialogTitle>
            <DialogDescription>
              Review the details and decide if this submission is legitimate or fraudulent
            </DialogDescription>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-6">
              {/* Fraud Flags */}
              <Card className="border-warning/50">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    Fraud Flags Detected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {selectedSubmission.fraud_flags?.split('|').map((flag: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                        <span>{flag.trim()}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Applicant Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Full Name</label>
                  <p className="text-sm text-muted-foreground">{selectedSubmission.full_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Country</label>
                  <p className="text-sm text-muted-foreground">{selectedSubmission.country}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Email</label>
                  <p className="text-sm text-muted-foreground">{selectedSubmission.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">WhatsApp</label>
                  <p className="text-sm text-muted-foreground">{selectedSubmission.whatsapp_number}</p>
                </div>
              </div>

              {/* Project Details */}
              <div>
                <label className="text-sm font-medium">Project Title</label>
                <p className="text-sm text-muted-foreground mt-1">{selectedSubmission.project_title}</p>
              </div>

              <div>
                <label className="text-sm font-medium">Project Description</label>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {selectedSubmission.project_description}
                </p>
              </div>

              {/* AI Scores */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Overall Score</label>
                  <Badge variant="outline" className="mt-1">
                    {selectedSubmission.ai_overall_score || 'N/A'}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm font-medium">Impact Score</label>
                  <Badge variant="outline" className="mt-1">
                    {selectedSubmission.ai_impact_score || 'N/A'}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm font-medium">Feasibility Score</label>
                  <Badge variant="outline" className="mt-1">
                    {selectedSubmission.ai_feasibility_score || 'N/A'}
                  </Badge>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setDetailsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => markAsReviewedMutation.mutate({ id: selectedSubmission.id, isLegit: false })}
                  disabled={markAsReviewedMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Confirm Fraud
                </Button>
                <Button
                  variant="default"
                  onClick={() => markAsReviewedMutation.mutate({ id: selectedSubmission.id, isLegit: true })}
                  disabled={markAsReviewedMutation.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Legitimate
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
