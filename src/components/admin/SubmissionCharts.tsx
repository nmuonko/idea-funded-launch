import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';

// Darker color palette for charts
const CHART_COLORS = {
  primary: 'hsl(210, 100%, 45%)',
  secondary: 'hsl(160, 80%, 35%)',
  success: 'hsl(142, 76%, 35%)',
  warning: 'hsl(38, 92%, 40%)',
  info: 'hsl(199, 89%, 38%)',
  destructive: 'hsl(0, 84%, 50%)',
  muted: 'hsl(220, 14%, 30%)',
};

const STATUS_COLORS = [
  'hsl(220, 14%, 40%)', // pending - dark gray
  'hsl(199, 89%, 38%)',  // under_review - dark blue
  'hsl(142, 76%, 35%)',  // selected - dark green
  'hsl(0, 84%, 50%)',    // not_selected - red
];

export function SubmissionCharts() {
  const { data: chartData, isLoading } = useQuery({
    queryKey: ['submissionCharts'],
    queryFn: async () => {
      // Fetch all submissions with sessions
      const { data: submissions, error } = await supabase
        .from('user_submissions')
        .select('*, sessions(name, status)')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);
      const lastWeekStart = new Date(weekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);

      // Real-time metrics
      const todaySubmissions = submissions?.filter(s => new Date(s.created_at) >= todayStart).length || 0;
      const thisWeekSubmissions = submissions?.filter(s => new Date(s.created_at) >= weekStart).length || 0;
      const lastWeekSubmissions = submissions?.filter(s => 
        new Date(s.created_at) >= lastWeekStart && new Date(s.created_at) < weekStart
      ).length || 0;
      const weekTrend = lastWeekSubmissions > 0 
        ? ((thisWeekSubmissions - lastWeekSubmissions) / lastWeekSubmissions * 100).toFixed(1)
        : '0';

      // Process data for different charts - group by date
      const submissionsByDate = submissions?.reduce((acc: any, sub) => {
        const date = new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const existing = acc.find((item: any) => item.date === date);
        if (existing) {
          existing.count += 1;
          existing.funding += sub.funding_needed;
        } else {
          acc.push({ date, count: 1, funding: sub.funding_needed });
        }
        return acc;
      }, []);

      const submissionsByStatus = [
        { name: 'Pending', value: submissions?.filter(s => s.submission_status === 'pending').length || 0 },
        { name: 'Under Review', value: submissions?.filter(s => s.submission_status === 'under_review').length || 0 },
        { name: 'Selected', value: submissions?.filter(s => s.submission_status === 'selected').length || 0 },
        { name: 'Not Selected', value: submissions?.filter(s => s.submission_status === 'not_selected').length || 0 },
      ];

      const submissionsByCity = submissions?.reduce((acc: any, sub) => {
        const existing = acc.find((item: any) => item.city === sub.city_province);
        if (existing) {
          existing.count += 1;
        } else {
          acc.push({ city: sub.city_province, count: 1 });
        }
        return acc;
      }, []).sort((a: any, b: any) => b.count - a.count).slice(0, 8); // Top 8 cities

      const fundingOverTime = submissionsByDate?.map((item: any) => ({
        date: item.date,
        funding: item.funding,
      }));

      return {
        submissionsByDate,
        submissionsByStatus,
        submissionsByCity,
        fundingOverTime,
        realTimeMetrics: {
          today: todaySubmissions,
          thisWeek: thisWeekSubmissions,
          lastWeek: lastWeekSubmissions,
          weekTrend: parseFloat(weekTrend),
          trendDirection: parseFloat(weekTrend) >= 0 ? 'up' : 'down'
        }
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-strong p-3 rounded-lg border border-border/50 shadow-premium">
          <p className="font-semibold text-foreground">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name === 'Funding' ? `$${entry.value.toLocaleString()}` : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Real-time Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass border-primary/20">
          <CardHeader className="pb-3">
            <CardDescription>Today's Submissions</CardDescription>
            <CardTitle className="text-3xl font-bold text-primary flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              {chartData?.realTimeMetrics.today || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        
        <Card className="glass border-secondary/20">
          <CardHeader className="pb-3">
            <CardDescription>This Week</CardDescription>
            <CardTitle className="text-3xl font-bold text-secondary">
              {chartData?.realTimeMetrics.thisWeek || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        
        <Card className={`glass ${chartData?.realTimeMetrics.trendDirection === 'up' ? 'border-success/20' : 'border-warning/20'}`}>
          <CardHeader className="pb-3">
            <CardDescription>Week-over-Week Trend</CardDescription>
            <CardTitle className={`text-3xl font-bold flex items-center gap-2 ${
              chartData?.realTimeMetrics.trendDirection === 'up' ? 'text-success' : 'text-warning'
            }`}>
              {chartData?.realTimeMetrics.trendDirection === 'up' ? '↑' : '↓'}
              {Math.abs(chartData?.realTimeMetrics.weekTrend || 0)}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Submissions Over Time - Line Chart */}
        <Card className="glass-strong">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary animate-glow-pulse" />
            Submissions Over Time
          </CardTitle>
          <CardDescription>Daily submission trends</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData?.submissionsByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'hsl(var(--foreground))' }} />
              <Line 
                type="monotone" 
                dataKey="count" 
                name="Submissions"
                stroke={CHART_COLORS.primary}
                strokeWidth={3}
                dot={{ fill: CHART_COLORS.primary, r: 4 }}
                activeDot={{ r: 6, fill: CHART_COLORS.primary }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Submissions by Status - Pie Chart */}
      <Card className="glass-strong">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-secondary animate-glow-pulse" />
            Status Distribution
          </CardTitle>
          <CardDescription>Breakdown by submission status</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData?.submissionsByStatus}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData?.submissionsByStatus.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Submissions by City - Bar Chart */}
      <Card className="glass-strong">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-info animate-glow-pulse" />
            Top Cities
          </CardTitle>
          <CardDescription>Submissions by location</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData?.submissionsByCity}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                dataKey="city" 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '11px' }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar 
                dataKey="count" 
                name="Submissions"
                fill={CHART_COLORS.info}
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Funding Over Time - Area Chart */}
      <Card className="glass-strong">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-success animate-glow-pulse" />
            Funding Requested
          </CardTitle>
          <CardDescription>Total funding requests over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData?.fundingOverTime}>
              <defs>
                <linearGradient id="colorFunding" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                style={{ fontSize: '12px' }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="funding" 
                name="Funding"
                stroke={CHART_COLORS.success}
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorFunding)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
