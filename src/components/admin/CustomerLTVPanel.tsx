import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, TrendingUp, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LTVPrediction {
  userId: string;
  metrics: {
    completedOrders: number;
    totalSpent: number;
    avgOrderValue: number;
    abandonedCarts: number;
    abandonedValue: number;
    orderFrequencyDays: number;
    preferredCategories: Array<{ category: string; spent: number }>;
  };
  prediction: {
    predictedLTV: number;
    tier: string;
    riskLevel: string;
    recommendations: string[];
  };
}

export default function CustomerLTVPanel() {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<LTVPrediction | null>(null);
  const { toast } = useToast();

  const analyzeLTV = async () => {
    if (!userId.trim()) {
      toast({ title: 'Error', description: 'Please enter a user ID', variant: 'destructive' });
      return;
    }

    try {
      setLoading(true);
      setPrediction(null);

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'predict_ltv', userId: userId.trim() },
      });

      if (error) throw error;

      if (data.error) {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
        return;
      }

      setPrediction(data);
      toast({ title: 'Success', description: 'LTV prediction generated!' });
    } catch (error: any) {
      console.error('LTV prediction error:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'Platinum': return 'bg-purple-600';
      case 'Gold': return 'bg-yellow-600';
      case 'Silver': return 'bg-gray-500';
      case 'Bronze': return 'bg-orange-700';
      default: return 'bg-gray-600';
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Low': return 'bg-emerald-600';
      case 'Medium': return 'bg-yellow-600';
      case 'High': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          AI-Powered Customer LTV Prediction
        </CardTitle>
        <CardDescription>
          Predict lifetime value based on purchase behavior and cart activity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter User ID..."
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyzeLTV()}
          />
          <Button onClick={analyzeLTV} disabled={loading}>
            {loading ? 'Analyzing...' : 'Predict LTV'}
          </Button>
        </div>

        {prediction && (
          <div className="space-y-4 pt-4 border-t">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Predicted 12-Month LTV</div>
                  <div className="text-3xl font-bold text-emerald-600">
                    ${prediction.prediction.predictedLTV.toFixed(2)}
                  </div>
                </div>

                <div className="flex gap-2">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Customer Tier</div>
                    <Badge className={getTierColor(prediction.prediction.tier)}>
                      {prediction.prediction.tier}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Churn Risk</div>
                    <Badge className={getRiskColor(prediction.prediction.riskLevel)}>
                      {prediction.prediction.riskLevel}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Current Metrics</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed Orders:</span>
                    <span className="font-medium">{prediction.metrics.completedOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Spent:</span>
                    <span className="font-medium">${prediction.metrics.totalSpent.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Order:</span>
                    <span className="font-medium">${prediction.metrics.avgOrderValue.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Abandoned Carts:</span>
                    <span className="font-medium text-orange-600">
                      {prediction.metrics.abandonedCarts} (${prediction.metrics.abandonedValue.toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {prediction.metrics.preferredCategories.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2">Preferred Categories</div>
                <div className="flex gap-2 flex-wrap">
                  {prediction.metrics.preferredCategories.map((cat) => (
                    <Badge key={cat.category} variant="outline">
                      {cat.category}: ${cat.spent.toFixed(2)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-sm font-semibold mb-2 flex items-center gap-1">
                <TrendingUp className="h-4 w-4" />
                AI Recommendations to Increase LTV
              </div>
              <ul className="space-y-2">
                {prediction.prediction.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}