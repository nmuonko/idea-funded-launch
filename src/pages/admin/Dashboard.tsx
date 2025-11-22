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
  const { data: stats } = useQuery({
    queryKey: ['adminStats'],
    queryFn: async () => {
      const [sessions, submissions, pending, selected, contacts] = await Promise.all([
        supabase.from('sessions').select('*', { count: 'exact', head: true }),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }).eq('submission_status', 'pending'),
        supabase.from('user_submissions').select('*', { count: 'exact', head: true }).eq('submission_status', 'selected'),
        supabase.from('contact_messages').select('*', { count: 'exact', head: true }),
      ]);

      // Calculate total funding requested
      const { data: fundingData } = await supabase
        .from('user_submissions')
        .select('funding_needed');
      
      const totalFunding = fundingData?.reduce((sum, sub) => sum + sub.funding_needed, 0) || 0;

      return {
        totalSessions: sessions.count || 0,
        totalSubmissions: submissions.count || 0,
        pendingReviews: pending.count || 0,
        winners: selected.count || 0,
        contactMessages: contacts.count || 0,
        totalFunding,
      };
    },
  });

  const statCards = [
    {
      title: 'Total Sessions',
      value: stats?.totalSessions || 0,
      icon: Clock,
      description: 'Competition sessions',
      color: 'text-primary',
      link: '/admin/sessions',
    },
    {
      title: 'Total Submissions',
      value: stats?.totalSubmissions || 0,
      icon: FileText,
      description: 'Project applications',
      color: 'text-secondary',
      link: '/admin/submissions',
    },
    {
      title: 'Pending Reviews',
      value: stats?.pendingReviews || 0,
      icon: Users,
      description: 'Awaiting evaluation',
      color: 'text-warning',
      link: '/admin/submissions',
    },
    {
      title: 'Winners Selected',
      value: stats?.winners || 0,
      icon: Trophy,
      description: 'Successful projects',
      color: 'text-success',
      link: '/admin/submissions',
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
        <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <Bug className="h-5 w-5" />
              Admin Debug Info (Preview Only)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs overflow-auto p-2 bg-white dark:bg-gray-900 rounded">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
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
