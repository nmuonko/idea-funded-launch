import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Filter } from 'lucide-react';
import { OrdersOverviewChart } from './OrdersOverviewChart';
import { ConversionFunnel } from './ConversionFunnel';
import type { DateRange } from './DateRangeFilter';

interface ChartTabsProps {
  dateRange?: DateRange;
}

export function ChartTabs({ dateRange }: ChartTabsProps) {
  const [activeTab, setActiveTab] = useState('orders');

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <CardHeader className="pb-0">
          <TabsList className="grid w-full max-w-[320px] grid-cols-2 bg-muted/50">
            <TabsTrigger value="orders" className="gap-2 text-sm">
              <BarChart3 className="h-4 w-4" />
              Orders Overview
            </TabsTrigger>
            <TabsTrigger value="funnel" className="gap-2 text-sm">
              <Filter className="h-4 w-4" />
              Conversion
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="pt-4">
          <TabsContent value="orders" className="mt-0">
            {activeTab === 'orders' && <OrdersOverviewChart dateRange={dateRange} embedded />}
          </TabsContent>
          <TabsContent value="funnel" className="mt-0">
            {activeTab === 'funnel' && <ConversionFunnel dateRange={dateRange} embedded />}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
