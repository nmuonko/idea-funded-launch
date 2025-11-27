import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DollarSign, TrendingUp } from 'lucide-react';

interface ProfitCalculatorProps {
  itemTotal: number;
  shippingFee: number;
  serviceFee: number;
  total: number;
  exchangeRate?: number;
  globalMarkup?: number;
}

export function ProfitCalculator({
  itemTotal,
  shippingFee,
  serviceFee,
  total,
  exchangeRate = 2800,
  globalMarkup = 0.15,
}: ProfitCalculatorProps) {
  // Calculate estimated costs
  const estimatedProductCost = itemTotal / (1 + globalMarkup);
  const estimatedShippingCost = shippingFee * 0.7; // Assume 70% of shipping fee is actual cost
  const customsDuty = itemTotal * 0.10; // Estimate 10% customs duty
  const totalCosts = estimatedProductCost + estimatedShippingCost + customsDuty;
  const grossProfit = total - totalCosts;
  const profitMargin = (grossProfit / total) * 100;

  return (
    <Card className="border-ocean-light/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-ocean-dark dark:text-ocean-light">
          <TrendingUp className="h-5 w-5" />
          Profit Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Revenue */}
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2">Revenue</h4>
          <div className="flex justify-between items-center">
            <span className="text-sm">Total Order Value</span>
            <span className="font-bold text-ocean-medium dark:text-ocean-light">
              ${total.toFixed(2)}
            </span>
          </div>
        </div>

        <Separator />

        {/* Costs Breakdown */}
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2">Estimated Costs</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span>Product Cost</span>
              <span>${estimatedProductCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span>Shipping Cost</span>
              <span>${estimatedShippingCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span>Customs Duty (est. 10%)</span>
              <span>${customsDuty.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm font-semibold pt-2 border-t">
              <span>Total Costs</span>
              <span>${totalCosts.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Markup */}
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2">Markup</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span>Markup Percentage</span>
              <span className="font-medium">{(globalMarkup * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span>Service Fee</span>
              <span>${serviceFee.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Profit */}
        <div className="bg-ocean-light/10 dark:bg-ocean-dark/30 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold">Gross Profit</span>
            <span className="text-lg font-bold text-ocean-medium dark:text-ocean-light">
              ${grossProfit.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Profit Margin</span>
            <span className={`text-sm font-semibold ${
              profitMargin > 20 ? 'text-green-600 dark:text-green-400' : 
              profitMargin > 10 ? 'text-yellow-600 dark:text-yellow-400' : 
              'text-red-600 dark:text-red-400'
            }`}>
              {profitMargin.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* CDF Conversion */}
        {exchangeRate && (
          <div className="pt-2">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Profit in CDF</span>
              <span className="font-medium">
                {(grossProfit * exchangeRate).toLocaleString()} CDF
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
