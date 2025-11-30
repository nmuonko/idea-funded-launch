import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, Mail, Target } from 'lucide-react';
import CartValueHeatmap from '@/components/admin/CartValueHeatmap';
import CustomerLTVPanel from '@/components/admin/CustomerLTVPanel';

interface ABTestMetrics {
  variant: string;
  emailsSent: number;
  emailOpens: number;
  conversions: number;
  openRate: number;
  conversionRate: number;
  avgCartValue: number;
  totalRevenue: number;
}

export default function ABTestResults() {
  const [metrics, setMetrics] = useState<ABTestMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);

      const { data: tests, error } = await supabase
        .from('cart_recovery_ab_tests')
        .select('*');

      if (error) throw error;

      // Group by variant and calculate metrics
      const variantMap: Record<string, ABTestMetrics> = {};

      (tests || []).forEach((test) => {
        const variant = test.variant_name;
        
        if (!variantMap[variant]) {
          variantMap[variant] = {
            variant,
            emailsSent: 0,
            emailOpens: 0,
            conversions: 0,
            openRate: 0,
            conversionRate: 0,
            avgCartValue: 0,
            totalRevenue: 0,
          };
        }

        variantMap[variant].emailsSent++;
        if (test.email_opened) variantMap[variant].emailOpens++;
        if (test.converted) {
          variantMap[variant].conversions++;
          variantMap[variant].totalRevenue += Number(test.cart_value_usd || 0);
        }
      });

      // Calculate rates
      const metricsArray = Object.values(variantMap).map((m) => ({
        ...m,
        openRate: m.emailsSent > 0 ? (m.emailOpens / m.emailsSent) * 100 : 0,
        conversionRate: m.emailsSent > 0 ? (m.conversions / m.emailsSent) * 100 : 0,
        avgCartValue: m.conversions > 0 ? m.totalRevenue / m.conversions : 0,
      }));

      // Sort by conversion rate descending
      metricsArray.sort((a, b) => b.conversionRate - a.conversionRate);

      setMetrics(metricsArray);
    } catch (error) {
      console.error('Error loading A/B test metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getBestVariantBadge = (index: number) => {
    if (index === 0) {
      return <Badge className="bg-emerald-600">Best Performing</Badge>;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Target className="h-8 w-8" />
          Cart Analytics & Recovery
        </h1>
        <p className="text-muted-foreground">
          Advanced analytics for abandoned cart optimization
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CartValueHeatmap />
        <CustomerLTVPanel />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tests Sent</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.reduce((sum, m) => sum + m.emailsSent, 0)}
            </div>
            <p className="text-xs text-muted-foreground">Across all variants</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversions</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {metrics.reduce((sum, m) => sum + m.conversions, 0)}
            </div>
            <p className="text-xs text-muted-foreground">Completed orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${metrics.reduce((sum, m) => sum + m.totalRevenue, 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">From recovered carts</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variant Performance</CardTitle>
          <CardDescription>
            Compare email timing strategies
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading metrics...</div>
          ) : metrics.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No A/B test data yet. Wait for abandoned cart emails to be sent.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead>Emails Sent</TableHead>
                  <TableHead>Open Rate</TableHead>
                  <TableHead>Conversion Rate</TableHead>
                  <TableHead>Conversions</TableHead>
                  <TableHead>Avg Cart Value</TableHead>
                  <TableHead>Total Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.map((metric, index) => (
                  <TableRow key={metric.variant}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{metric.variant}</span>
                        {getBestVariantBadge(index)}
                      </div>
                    </TableCell>
                    <TableCell>{metric.emailsSent}</TableCell>
                    <TableCell>{metric.openRate.toFixed(1)}%</TableCell>
                    <TableCell>
                      <span className="font-bold text-emerald-600">
                        {metric.conversionRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{metric.conversions}</TableCell>
                    <TableCell>${metric.avgCartValue.toFixed(2)}</TableCell>
                    <TableCell className="font-semibold">
                      ${metric.totalRevenue.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Understanding the Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="font-semibold mb-1">24h Variant</div>
            <p className="text-sm text-muted-foreground">
              Emails sent 24 hours after cart abandonment. Tests immediate follow-up effectiveness.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-1">48h Variant</div>
            <p className="text-sm text-muted-foreground">
              Emails sent 48 hours after abandonment. Balances urgency with giving customers time to decide.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-1">72h Variant</div>
            <p className="text-sm text-muted-foreground">
              Emails sent 72 hours after abandonment. Tests late-stage recovery for delayed decision-makers.
            </p>
          </div>
          <div className="pt-3 border-t">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> Conversion tracking requires manual order status updates or webhook integration. 
              The system tracks which variant was sent to each cart for analysis.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
