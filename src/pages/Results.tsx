import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Search, Clock } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import SessionProgressSteps from '@/components/SessionProgressSteps';

export default function Results() {
  const { t } = useLanguage();
  const [searchInput, setSearchInput] = useState('');
  const [searchedSubmission, setSearchedSubmission] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [countdown, setCountdown] = useState('');

  // Check if there's a ref parameter in URL
  const refFromUrl = new URLSearchParams(window.location.search).get('ref');

  useEffect(() => {
    if (refFromUrl) {
      setSearchInput(refFromUrl);
      handleSearch(refFromUrl);
    }
  }, [refFromUrl]);

  // Fetch active session
  const { data: activeSession, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['resultsSession'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, name, start_date, announcement_date, status, desired_max_participants, current_participant_count, application_fee, currency, enable_waitlist, waitlist_count, review_progress, payment_instructions, target_applicants, deadline_datetime')
        .in('status', ['open', 'closed', 'results_published'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Check if deadline has passed
  const deadlinePassed = activeSession?.deadline_datetime 
    ? new Date(activeSession.deadline_datetime).getTime() < new Date().getTime()
    : false;

  // Fetch winners for the active session
  const { data: winners } = useQuery({
    queryKey: ['winners', activeSession?.id],
    queryFn: async () => {
      if (!activeSession) return [];
      
      const { data, error } = await supabase
        .from('winners')
        .select('*')
        .eq('session_id', activeSession.id)
        .eq('is_published', true)
        .order('display_order');

      if (error) throw error;
      return data;
    },
    enabled: !!activeSession,
  });

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      if (!activeSession?.deadline_datetime) {
        setCountdown('No deadline set');
        return;
      }

      const now = new Date().getTime();
      const deadline = new Date(activeSession.deadline_datetime).getTime();
      const distance = deadline - now;

      if (distance < 0) {
        setCountdown('Deadline passed');
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  // Show loading state
  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show error if session can't load
  if (sessionError) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Results</CardTitle>
            <CardDescription>Unable to load session data. Please try again later.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show no active session message
  if (!activeSession) {
    return (
      <div className="container mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>No Active Session</CardTitle>
            <CardDescription>
              There is currently no active funding session to display results for. Please check back later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/">Return Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSearch = async (searchTerm?: string) => {
    const term = searchTerm || searchInput;
    if (!term.trim()) return;

    setSearching(true);
    try {
      // Try searching by confirmation ID first
      const { data: byConfirmation, error: confError } = await supabase
        .from('user_submissions')
        .select('*')
        .eq('confirmation_id', term.trim().toUpperCase())
        .maybeSingle();

      if (byConfirmation) {
        setSearchedSubmission(byConfirmation);
      } else {
        // Fallback to project code search
        const { data, error } = await supabase
          .rpc('search_submission_by_code', { search_code: term.trim().toUpperCase() });

        if (error) throw error;
        setSearchedSubmission(data?.[0] || null);
      }
    } catch (error) {
      console.error('Error searching project:', error);
      setSearchedSubmission(null);
    } finally {
      setSearching(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: t.results.statusPending, variant: 'secondary' },
      under_review: { label: t.results.statusUnderReview, variant: 'default' },
      not_selected: { label: t.results.statusNotSelected, variant: 'outline' },
      selected: { label: t.results.statusSelected, variant: 'default' },
    };

    const config = statusMap[status] || statusMap.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getSessionStatusLabel = () => {
    if (!activeSession) return '';
    switch (activeSession.status) {
      case 'open':
        return t.results.sessionOpen;
      case 'closed':
        return t.results.sessionFull;
      case 'results_published':
        return t.results.sessionPublished;
      default:
        return '';
    }
  };

  return (
    <div className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-4xl md:text-5xl font-bold">{t.results.title}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t.results.subtitle}
          </p>
        </div>

        <div className="max-w-4xl mx-auto space-y-8">
          {/* Session Progress Card */}
          {activeSession && (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">Current Application Session: {activeSession.name}</CardTitle>
                <CardDescription>{getSessionStatusLabel()}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Session Progress Steps */}
                <SessionProgressSteps 
                  status={activeSession.status}
                  deadlinePassed={deadlinePassed}
                />

                {/* Countdown Timer */}
                <div className="flex items-center justify-center gap-3 p-4 border rounded-lg">
                  <Clock className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Time Remaining</p>
                    <p className="text-lg font-bold">{countdown}</p>
                  </div>
                </div>

                {activeSession.deadline_datetime && (
                  <p className="text-center text-sm text-muted-foreground">
                    Application deadline: {new Date(activeSession.deadline_datetime).toLocaleDateString()} at{' '}
                    {new Date(activeSession.deadline_datetime).toLocaleTimeString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Winners Section */}
          {activeSession && (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">Winners – {activeSession.name}</CardTitle>
              </CardHeader>
              <CardContent>
                {winners && winners.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Full Name</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Country</TableHead>
                          <TableHead>Award</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {winners.map((winner: any) => (
                          <TableRow key={winner.id}>
                            <TableCell className="font-medium">{winner.winner_name}</TableCell>
                            <TableCell>{winner.project_name}</TableCell>
                            <TableCell>{winner.country}</TableCell>
                            <TableCell className="font-semibold text-primary">
                              ${winner.award_amount?.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    No winners yet. Results will be published after the deadline and once the review process is completed.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Track Application */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">Track Your Application</CardTitle>
              <CardDescription>
                Search using your Confirmation ID (AFF-YYYYMMDD-XXXXXXXX) or Project Code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="searchInput">Confirmation ID or Project Code</Label>
                  <Input
                    id="searchInput"
                    placeholder="AFF-20251124-ABC123 or PC-2025-XXXX"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={() => handleSearch()} disabled={searching || !searchInput.trim()}>
                    {searching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {searchedSubmission && (
                <Card className="bg-muted/50">
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      {searchedSubmission.confirmation_id && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">Confirmation ID:</span>
                          <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                            {searchedSubmission.confirmation_id}
                          </code>
                        </div>
                      )}
                      {searchedSubmission.project_code && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">Project Code:</span>
                          <span>{searchedSubmission.project_code}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Applicant Name:</span>
                        <span>{searchedSubmission.full_name}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Project Title:</span>
                        <span>{searchedSubmission.project_title}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Payment Status:</span>
                        <Badge
                          variant={
                            searchedSubmission.payment_status === 'paid'
                              ? 'default'
                              : searchedSubmission.payment_status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {searchedSubmission.payment_status?.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Competition Status:</span>
                        {getStatusBadge(searchedSubmission.submission_status)}
                      </div>
                      {searchedSubmission.submitted_at && (
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">Submitted:</span>
                          <span className="text-sm">
                            {new Date(searchedSubmission.submitted_at).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {searchedSubmission === null && !searching && searchInput.trim() && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No application found with this ID or code.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
