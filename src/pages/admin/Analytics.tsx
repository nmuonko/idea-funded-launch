import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Users, AlertTriangle, BarChart3 } from "lucide-react";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [fraudList, setFraudList] = useState<any[]>([]);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      // Fetch all paid, non-draft submissions for analytics
      const { data: submissions, error } = await supabase
        .from('user_submissions')
        .select('*')
        .eq('payment_status', 'paid')
        .eq('is_draft', false);

      if (error) throw error;

      // Calculate statistics
      const categoryStats = submissions?.reduce((acc: any, sub) => {
        const cat = sub.category || 'Uncategorized';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});

      const countryStats = submissions?.reduce((acc: any, sub) => {
        const country = sub.country || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {});

      const typeStats = submissions?.reduce((acc: any, sub) => {
        const type = sub.submission_type || 'text';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

      // Score statistics
      const scores = submissions?.map(s => ({
        impact: s.ai_impact_score || 0,
        feasibility: s.ai_feasibility_score || 0,
        overall: s.ai_overall_score || 0,
      })) || [];

      const avgScores = {
        impact: scores.reduce((sum, s) => sum + s.impact, 0) / scores.length || 0,
        feasibility: scores.reduce((sum, s) => sum + s.feasibility, 0) / scores.length || 0,
        overall: scores.reduce((sum, s) => sum + s.overall, 0) / scores.length || 0,
      };

      const minScores = {
        impact: Math.min(...scores.map(s => s.impact)),
        feasibility: Math.min(...scores.map(s => s.feasibility)),
        overall: Math.min(...scores.map(s => s.overall)),
      };

      const maxScores = {
        impact: Math.max(...scores.map(s => s.impact)),
        feasibility: Math.max(...scores.map(s => s.feasibility)),
        overall: Math.max(...scores.map(s => s.overall)),
      };

      // Fraud statistics
      const fraudCount = submissions?.filter(s => s.is_suspected_fraud).length || 0;
      const duplicateCount = submissions?.filter(s => s.is_possible_duplicate).length || 0;
      const totalCount = submissions?.length || 0;

      // Top 20 suspicious submissions
      const suspicious = submissions
        ?.filter(s => s.is_suspected_fraud || s.is_possible_duplicate)
        .sort((a, b) => {
          if (a.is_suspected_fraud && !b.is_suspected_fraud) return -1;
          if (!a.is_suspected_fraud && b.is_suspected_fraud) return 1;
          return 0;
        })
        .slice(0, 20) || [];

      setStats({
        categoryData: Object.entries(categoryStats || {}).map(([name, value]) => ({ name, value })),
        countryData: Object.entries(countryStats || {}).map(([name, value]) => ({ name, value })),
        typeData: Object.entries(typeStats || {}).map(([name, value]) => ({ name, value })),
        avgScores,
        minScores,
        maxScores,
        fraudCount,
        duplicateCount,
        totalCount,
        fraudPercentage: totalCount > 0 ? ((fraudCount / totalCount) * 100).toFixed(1) : 0,
        duplicatePercentage: totalCount > 0 ? ((duplicateCount / totalCount) * 100).toFixed(1) : 0,
      });

      setFraudList(suspicious);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
        <p className="text-muted-foreground">Comprehensive insights into submissions and fraud detection</p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Overall Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.avgScores.overall.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">Out of 10</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suspected Fraud</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.fraudCount}</div>
            <p className="text-xs text-muted-foreground">{stats?.fraudPercentage}% of total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Possible Duplicates</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.duplicateCount}</div>
            <p className="text-xs text-muted-foreground">{stats?.duplicatePercentage}% of total</p>
          </CardContent>
        </Card>
      </div>

      {/* Score Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>AI Score Statistics</CardTitle>
          <CardDescription>Average, minimum, and maximum scores across all submissions</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={[
                { metric: 'Impact', avg: stats?.avgScores.impact, min: stats?.minScores.impact, max: stats?.maxScores.impact },
                { metric: 'Feasibility', avg: stats?.avgScores.feasibility, min: stats?.minScores.feasibility, max: stats?.maxScores.feasibility },
                { metric: 'Overall', avg: stats?.avgScores.overall, min: stats?.minScores.overall, max: stats?.maxScores.overall },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="metric" />
              <YAxis domain={[0, 10]} />
              <Tooltip />
              <Legend />
              <Bar dataKey="avg" fill="#0088FE" name="Average" />
              <Bar dataKey="min" fill="#FF8042" name="Minimum" />
              <Bar dataKey="max" fill="#00C49F" name="Maximum" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Category Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Submissions by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stats?.categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {stats?.categoryData.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submissions by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats?.typeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Submissions by Country */}
      <Card>
        <CardHeader>
          <CardTitle>Submissions by Country</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats?.countryData.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#00C49F" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Suspicious Submissions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top 20 Suspicious Submissions</CardTitle>
          <CardDescription>Submissions flagged for fraud or detected as duplicates</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Title</TableHead>
                <TableHead>Applicant</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fraudList.map((submission) => (
                <TableRow key={submission.id}>
                  <TableCell className="font-medium">{submission.project_title}</TableCell>
                  <TableCell>{submission.full_name}</TableCell>
                  <TableCell>{submission.country}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{submission.fraud_flags || 'N/A'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {submission.is_suspected_fraud && (
                        <Badge variant="destructive">Fraud</Badge>
                      )}
                      {submission.is_possible_duplicate && (
                        <Badge variant="secondary">Duplicate</Badge>
                      )}
                    </div>
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
