import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Search } from 'lucide-react';

export default function Results() {
  const { t } = useLanguage();
  const [projectCode, setProjectCode] = useState('');
  const [searchedSubmission, setSearchedSubmission] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  // Fetch active session
  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ['resultsSession'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .in('status', ['open', 'closed', 'results_published'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
  });

  // Fetch winners for published sessions
  const { data: winners } = useQuery({
    queryKey: ['winners', activeSession?.id],
    queryFn: async () => {
      if (!activeSession || activeSession.status !== 'results_published') return [];
      
      const { data, error } = await supabase
        .from('user_submissions')
        .select('project_code, project_title, city_province, funding_needed')
        .eq('session_id', activeSession.id)
        .eq('submission_status', 'selected')
        .order('project_code');

      if (error) throw error;
      return data;
    },
    enabled: !!activeSession && activeSession.status === 'results_published',
  });

  const handleSearch = async () => {
    if (!projectCode.trim()) return;

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('*, sessions(name, status)')
        .eq('project_code', projectCode.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      setSearchedSubmission(data);
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

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
          {/* Session Status */}
          {activeSession && (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">{t.results.sessionStatus}</CardTitle>
                <CardDescription>
                  {activeSession.name} - {getSessionStatusLabel()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{t.results.reviewProgress}</span>
                    <span className="text-muted-foreground">{activeSession.review_progress}%</span>
                  </div>
                  <Progress value={activeSession.review_progress} className="h-3" />
                  <p className="text-sm text-muted-foreground">
                    {activeSession.review_progress < 100 ? t.results.progressMessage : t.results.completionMessage}
                  </p>
                </div>

                {activeSession.status === 'open' && (
                  <div className="pt-2">
                    <p className="text-sm text-muted-foreground">
                      {t.common.loading} {activeSession.current_participant_count} / {activeSession.desired_max_participants} participants
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Project Code Lookup */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-2xl">{t.results.checkYourStatus}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="projectCode">{t.results.enterProjectCode}</Label>
                  <Input
                    id="projectCode"
                    placeholder="PC-2025-XXXX"
                    value={projectCode}
                    onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleSearch} disabled={searching || !projectCode.trim()}>
                    {searching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        {t.results.checkStatus}
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {searchedSubmission && (
                <Card className="bg-muted/50">
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.results.projectCode}:</span>
                        <span>{searchedSubmission.project_code}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.results.projectTitle}:</span>
                        <span>{searchedSubmission.project_title}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{t.common.loading}:</span>
                        {getStatusBadge(searchedSubmission.submission_status)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {projectCode && !searching && searchedSubmission === null && (
                <p className="text-sm text-muted-foreground text-center">
                  No project found with this code
                </p>
              )}
            </CardContent>
          </Card>

          {/* Winners List */}
          {activeSession?.status === 'results_published' && (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-2xl">{t.results.winnersTitle}</CardTitle>
                <CardDescription>{activeSession.name}</CardDescription>
              </CardHeader>
              <CardContent>
                {winners && winners.length > 0 ? (
                  <div className="space-y-3">
                    {winners.map((winner: any) => (
                      <Card key={winner.project_code} className="bg-success/5 border-success/20">
                        <CardContent className="pt-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <p className="text-sm text-muted-foreground">{t.results.projectCode}</p>
                              <p className="font-semibold">{winner.project_code}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t.results.projectTitle}</p>
                              <p className="font-semibold">{winner.project_title}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t.results.fundingAwarded}</p>
                              <p className="font-semibold text-success">${winner.funding_needed}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">{t.results.noWinners}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
