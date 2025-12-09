import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Clock, CheckCircle, TrendingUp, Users, MessageSquare, AlertCircle } from 'lucide-react';
import { formatDistanceToNow, differenceInHours, differenceInMinutes } from 'date-fns';

interface AnalyticsData {
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  averageResponseTime: number;
  averageResolutionTime: number;
  resolutionRate: number;
  ticketsByPriority: Record<string, number>;
  ticketsByStatus: Record<string, number>;
  commonIssues: Array<{ subject: string; count: number }>;
  staffPerformance: Array<{
    staff_id: string;
    tickets_handled: number;
    avg_response_time: number;
  }>;
  averageCSAT: number;
  csatCount: number;
  escalatedCount: number;
}

export default function TicketAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalTickets: 0,
    openTickets: 0,
    resolvedTickets: 0,
    averageResponseTime: 0,
    averageResolutionTime: 0,
    resolutionRate: 0,
    ticketsByPriority: {},
    ticketsByStatus: {},
    commonIssues: [],
    staffPerformance: [],
    averageCSAT: 0,
    csatCount: 0,
    escalatedCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const { data: tickets, error: ticketsError } = await supabase
        .from('support_tickets')
        .select('*');

      if (ticketsError) throw ticketsError;

      const { data: messages, error: messagesError } = await supabase
        .from('ticket_messages')
        .select('id, message, is_admin, created_at, ticket_id, user_id');

      if (messagesError) throw messagesError;

      // Calculate metrics
      const totalTickets = tickets?.length || 0;
      const resolvedTickets = tickets?.filter(t => t.status === 'resolved' || t.status === 'closed').length || 0;
      const openTickets = tickets?.filter(t => t.status === 'open' || t.status === 'in_progress').length || 0;

      // Response time calculation
      let totalResponseTime = 0;
      let responseCount = 0;
      tickets?.forEach(ticket => {
        const firstAdminResponse = messages?.find(m => m.ticket_id === ticket.id && m.is_admin);
        if (firstAdminResponse) {
          const responseTime = differenceInMinutes(
            new Date(firstAdminResponse.created_at),
            new Date(ticket.created_at)
          );
          totalResponseTime += responseTime;
          responseCount++;
        }
      });

      // Resolution time calculation
      let totalResolutionTime = 0;
      let resolutionCount = 0;
      tickets?.forEach(ticket => {
        if (ticket.resolved_at) {
          const resolutionTime = differenceInHours(
            new Date(ticket.resolved_at),
            new Date(ticket.created_at)
          );
          totalResolutionTime += resolutionTime;
          resolutionCount++;
        }
      });

      // Priority breakdown
      const priorityCounts: Record<string, number> = {};
      tickets?.forEach(ticket => {
        priorityCounts[ticket.priority] = (priorityCounts[ticket.priority] || 0) + 1;
      });

      // Status breakdown
      const statusCounts: Record<string, number> = {};
      tickets?.forEach(ticket => {
        statusCounts[ticket.status] = (statusCounts[ticket.status] || 0) + 1;
      });

      // Common issues (group by subject keywords)
      const subjectGroups: Record<string, number> = {};
      tickets?.forEach(ticket => {
        const keywords = ticket.subject.toLowerCase().split(' ');
        keywords.forEach(keyword => {
          if (keyword.length > 4) {
            subjectGroups[keyword] = (subjectGroups[keyword] || 0) + 1;
          }
        });
      });
      const commonIssues = Object.entries(subjectGroups)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([subject, count]) => ({ subject, count }));

      // Staff performance (assigned_to)
      const staffStats: Record<string, { count: number; totalResponseTime: number }> = {};
      tickets?.forEach(ticket => {
        if (ticket.assigned_to) {
          if (!staffStats[ticket.assigned_to]) {
            staffStats[ticket.assigned_to] = { count: 0, totalResponseTime: 0 };
          }
          staffStats[ticket.assigned_to].count++;

          const firstAdminResponse = messages?.find(
            m => m.ticket_id === ticket.id && m.is_admin
          );
          if (firstAdminResponse) {
            const responseTime = differenceInMinutes(
              new Date(firstAdminResponse.created_at),
              new Date(ticket.created_at)
            );
            staffStats[ticket.assigned_to].totalResponseTime += responseTime;
          }
        }
      });

      const staffPerformance = Object.entries(staffStats).map(([staff_id, stats]) => ({
        staff_id,
        tickets_handled: stats.count,
        avg_response_time: stats.totalResponseTime / stats.count,
      }));

      // Calculate CSAT
      const ratedTickets = tickets?.filter(t => t.rating !== null) || [];
      const csatCount = ratedTickets.length;
      const averageCSAT = csatCount > 0 
        ? ratedTickets.reduce((sum, t) => sum + (t.rating || 0), 0) / csatCount 
        : 0;

      // Count escalated tickets
      const escalatedCount = tickets?.filter(t => t.escalated).length || 0;

      setAnalytics({
        totalTickets,
        openTickets,
        resolvedTickets,
        averageResponseTime: responseCount > 0 ? totalResponseTime / responseCount : 0,
        averageResolutionTime: resolutionCount > 0 ? totalResolutionTime / resolutionCount : 0,
        resolutionRate: totalTickets > 0 ? (resolvedTickets / totalTickets) * 100 : 0,
        ticketsByPriority: priorityCounts,
        ticketsByStatus: statusCounts,
        commonIssues,
        staffPerformance,
        averageCSAT,
        csatCount,
        escalatedCount,
      });
    } catch (error: any) {
      toast.error('Failed to load analytics');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-ocean bg-clip-text text-transparent">
          Ticket Analytics
        </h1>
        <p className="text-muted-foreground mt-2">
          Support performance metrics and insights
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalTickets}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.openTickets}</div>
            <p className="text-xs text-muted-foreground">Needs attention</p>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolution Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.resolutionRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">{analytics.resolvedTickets} resolved</p>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTime(analytics.averageResponseTime)}</div>
            <p className="text-xs text-muted-foreground">First response</p>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Customer Satisfaction</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.averageCSAT.toFixed(1)}/5</div>
            <p className="text-xs text-muted-foreground">{analytics.csatCount} ratings</p>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Escalated Tickets</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.escalatedCount}</div>
            <p className="text-xs text-muted-foreground">Requires urgent attention</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>Resolution Metrics</CardTitle>
            <CardDescription>Average time to resolve tickets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Average Resolution Time</span>
                <Badge variant="outline">{analytics.averageResolutionTime.toFixed(1)} hours</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">First Response Time</span>
                <Badge variant="outline">{formatTime(analytics.averageResponseTime)}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>Tickets by Priority</CardTitle>
            <CardDescription>Distribution of ticket urgency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(analytics.ticketsByPriority).map(([priority, count]) => (
                <div key={priority} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{priority}</span>
                  <Badge>{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>Tickets by Status</CardTitle>
            <CardDescription>Current ticket status breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(analytics.ticketsByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{status.replace('_', ' ')}</span>
                  <Badge>{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-strong">
          <CardHeader>
            <CardTitle>Common Issues</CardTitle>
            <CardDescription>Most frequent ticket topics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analytics.commonIssues.map((issue, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{issue.subject}</span>
                  <Badge variant="outline">{issue.count} mentions</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {analytics.staffPerformance.length > 0 && (
        <Card className="glass-strong">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Staff Performance
            </CardTitle>
            <CardDescription>Support team metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analytics.staffPerformance.map((staff) => (
                <div key={staff.staff_id} className="flex items-center justify-between p-3 glass rounded-lg">
                  <div>
                    <p className="font-medium">{staff.staff_id.slice(0, 8)}...</p>
                    <p className="text-sm text-muted-foreground">
                      {staff.tickets_handled} tickets handled
                    </p>
                  </div>
                  <Badge variant="outline">
                    Avg: {formatTime(staff.avg_response_time)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
