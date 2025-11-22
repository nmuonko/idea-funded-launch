import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, FileText, Clock, Trophy, Mail, TrendingUp, Bug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SubmissionCharts } from '@/components/admin/SubmissionCharts';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const { user, isAdmin } = useAuth();
  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    const checkDebug = async () => {
      if (!user) return;
      
      const { data: adminCheck, error } = await supabase
        .from('admin_users')
        .select('email')
        .eq('email', user.email || '')
        .maybeSingle();

      setDebugInfo({
        userEmail: user.email,
        isAdminFromContext: isAdmin,
        adminRowFound: !!adminCheck,
        adminRowData: adminCheck,
        error: error?.message,
      });
    };

    checkDebug();
  }, [user, isAdmin]);

  // Fetch active session
  const { data: activeSession } = useQuery({
    queryKey: ['activeSession'],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_active_session');
      
      if (error) throw error;
      return data?.[0] || null;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['adminStats', activeSession?.id],
    queryFn: async () => {
      const [sessions, allSubmissions, pending, selected, contacts] = await Promise.all([
        supabase.from('sessions').select('*', { count: 'exact', head: true }),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }).eq('payment_status', 'paid').eq('is_draft', false),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }).eq('submission_status', 'pending').eq('payment_status', 'paid').eq('is_draft', false),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }).eq('submission_status', 'selected'),
        supabase.from('contact_messages').select('*', { count: 'exact', head: true }),
      ]);

      // Get submissions for active session
      let sessionSubmissions = null;
      if (activeSession) {
        sessionSubmissions = await supabase
          .from('user_submissions')
          .select('*')
          .eq('session_id', activeSession.id)
          .eq('payment_status', 'paid')
          .eq('is_draft', false);
      }

      // Calculate session-specific stats
      const sessionSubs = sessionSubmissions?.data || [];
      const textSubs = sessionSubs.filter(s => s.submission_type === 'text').length;
      const voiceSubs = sessionSubs.filter(s => s.submission_type === 'voice').length;
      const scores = sessionSubs.filter(s => s.ai_overall_score != null).map(s => s.ai_overall_score);
      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const fraudCount = sessionSubs.filter(s => s.is_suspected_fraud).length;

      // Calculate total funding requested
      const { data: fundingData } = await supabase
        .from('user_submissions')
        .select('funding_needed')
        .eq('payment_status', 'paid')
        .eq('is_draft', false);
      
      const totalFunding = fundingData?.reduce((sum, sub) => sum + sub.funding_needed, 0) || 0;

      return {
        totalSessions: sessions.count || 0,
        totalSubmissions: allSubmissions.count || 0,
        sessionSubmissions: sessionSubs.length,
        textSubmissions: textSubs,
        voiceSubmissions: voiceSubs,
        avgScore: avgScore.toFixed(1),
        fraudCount,
        pendingReviews: pending.count || 0,
        winners: selected.count || 0,
        contactMessages: contacts.count || 0,
        totalFunding,
      };
    },
    enabled: true,
  });

  const statCards = [
    {
      title: 'Session Submissions',
      value: stats?.sessionSubmissions || 0,
      icon: FileText,
      description: `${stats?.textSubmissions || 0} text, ${stats?.voiceSubmissions || 0} voice`,
      color: 'text-primary',
      link: '/admin/submissions',
    },
    {
      title: 'Average AI Score',
      value: stats?.avgScore || '0.0',
      icon: TrendingUp,
      description: 'For active session',
      color: 'text-secondary',
      link: '/admin/analytics',
    },
    {
      title: 'Fraud Detected',
      value: stats?.fraudCount || 0,
      icon: Bug,
      description: 'Suspected cases',
      color: 'text-warning',
      link: '/admin/analytics',
    },
    {
      title: 'Total Sessions',
      value: stats?.totalSessions || 0,
      icon: Clock,
      description: 'Competition sessions',
      color: 'text-info',
      link: '/admin/sessions',
    },
    {
      title: 'Contact Messages',
      value: stats?.contactMessages || 0,
      icon: Mail,
      description: 'Inbox messages',
      color: 'text-info',
      link: '/admin/contacts',
    },
    {
      title: 'Total Funding',
      value: `$${((stats?.totalFunding || 0) / 1000).toFixed(0)}k`,
      icon: TrendingUp,
      description: 'Requested capital',
      color: 'text-secondary',
      link: '/admin/submissions',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Debug Info Card - Remove this after testing */}
      {debugInfo && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300 text-sm">
              <Bug className="h-4 w-4" />
              🔍 Admin Status Debug
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1">
            <p><strong>Email:</strong> {debugInfo.userEmail}</p>
            <p><strong>Is Admin (Context):</strong> {debugInfo.isAdminFromContext ? '✅ Yes' : '❌ No'}</p>
            <p><strong>Admin Row Found:</strong> {debugInfo.adminRowFound ? '✅ Yes' : '❌ No'}</p>
            <p className="text-xs text-muted-foreground mt-2">
              This debug info will be removed once admin auth is verified working.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Active Session Info */}
      {activeSession && (
        <Card>
          <CardHeader>
            <CardTitle>Active Session: {activeSession.name}</CardTitle>
            <CardDescription>Current competition session details</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Target Applicants</p>
                <p className="text-2xl font-bold">{activeSession.target_applicants}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Count</p>
                <p className="text-2xl font-bold">{activeSession.current_participant_count}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Progress</p>
                <p className="text-2xl font-bold">
                  {activeSession.target_applicants > 0
                    ? ((activeSession.current_participant_count / activeSession.target_applicants) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h1 className="text-4xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-muted-foreground text-lg">
          Manage sessions, review submissions, and oversee the competition
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((stat) => (
          <Link key={stat.title} to={stat.link}>
            <Card className="glass hover:shadow-glow transition-smooth cursor-pointer group">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color} group-hover:scale-110 transition-transform`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Frequently used admin tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full justify-start" variant="outline">
              <Link to="/admin/sessions">
                <Clock className="mr-2 h-4 w-4" />
                Manage Sessions
              </Link>
            </Button>
            <Button asChild className="w-full justify-start" variant="outline">
              <Link to="/admin/submissions">
                <FileText className="mr-2 h-4 w-4" />
                Review Submissions
              </Link>
            </Button>
            <Button asChild className="w-full justify-start" variant="outline">
              <Link to="/admin/contacts">
                <Mail className="mr-2 h-4 w-4" />
                View Messages
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Platform health overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Database</span>
              <span className="text-sm font-semibold text-success">Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Authentication</span>
              <span className="text-sm font-semibold text-success">Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Notifications</span>
              <span className="text-sm font-semibold text-success">Ready</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Visualization Charts */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold mb-2">Analytics & Insights</h2>
          <p className="text-muted-foreground">Submission trends and statistics</p>
        </div>
        <SubmissionCharts />
      </div>
    </div>
  );
}
