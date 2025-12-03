import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Truck, CreditCard, ShoppingBag, Activity } from 'lucide-react';
import { ShippingMetrics } from './ShippingMetrics';
import { PaymentsBreakdown } from './PaymentsBreakdown';
import { SavedCartsReport } from './SavedCartsReport';
import type { DateRange } from './DateRangeFilter';

interface OperationalInsightsTabsProps {
  dateRange?: DateRange;
}

export function OperationalInsightsTabs({ dateRange }: OperationalInsightsTabsProps) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Operational Insights</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="payments" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50 mb-4">
            <TabsTrigger value="shipping" className="gap-2 text-sm">
              <Truck className="h-4 w-4" />
              <span className="hidden sm:inline">Shipping</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-2 text-sm">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Payments</span>
            </TabsTrigger>
            <TabsTrigger value="carts" className="gap-2 text-sm">
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">Saved Carts</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="shipping" className="mt-0">
            <ShippingMetrics dateRange={dateRange} embedded />
          </TabsContent>
          <TabsContent value="payments" className="mt-0">
            <PaymentsBreakdown dateRange={dateRange} embedded />
          </TabsContent>
          <TabsContent value="carts" className="mt-0">
            <SavedCartsReport embedded />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
