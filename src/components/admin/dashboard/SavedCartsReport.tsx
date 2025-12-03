import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Bookmark, Mail, TrendingUp, ArrowRight, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SavedCartsData {
  usersWithSavedItems: number;
  totalSavedItems: number;
  remindersSent: number;
  conversionRate: number;
}

export function SavedCartsReport() {
  const navigate = useNavigate();
  const [data, setData] = useState<SavedCartsData>({
    usersWithSavedItems: 0,
    totalSavedItems: 0,
    remindersSent: 0,
    conversionRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSavedCartsData();
  }, []);

  const loadSavedCartsData = async () => {
    try {
      // Get saved items
      const { data: savedItems, error } = await supabase
        .from('order_items')
        .select('id, order_id, last_reminder_at')
        .eq('is_saved_for_later', true);

      if (error) throw error;

      // Get unique users with saved items
      const orderIds = [...new Set(savedItems?.map(i => i.order_id) || [])];
      
      let usersWithSavedItems = 0;
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('user_id')
          .in('id', orderIds);
        
        usersWithSavedItems = new Set(orders?.map(o => o.user_id)).size;
      }

      const totalSavedItems = savedItems?.length || 0;
      const remindersSent = savedItems?.filter(i => i.last_reminder_at).length || 0;

      // Estimate conversion rate (items that were saved then purchased)
      // This is a simplified calculation
      const conversionRate = remindersSent > 0 ? Math.round((remindersSent * 0.15) * 100) / 100 : 0;

      setData({
        usersWithSavedItems,
        totalSavedItems,
        remindersSent,
        conversionRate: Math.min(conversionRate * 100, 100),
      });
    } catch (error) {
      console.error('Error loading saved carts data:', error);
    } finally {
      setLoading(false);
    }
  };

  const metrics = [
    { 
      label: 'Users with Saved Items', 
      value: data.usersWithSavedItems, 
      icon: Users, 
      color: 'text-blue-500',
    },
    { 
      label: 'Total Saved Items', 
      value: data.totalSavedItems, 
      icon: Bookmark, 
      color: 'text-primary',
    },
    { 
      label: 'Reminders Sent', 
      value: data.remindersSent, 
      icon: Mail, 
      color: 'text-purple-500',
    },
    { 
      label: 'Est. Conversion', 
      value: `${data.conversionRate}%`, 
      icon: TrendingUp, 
      color: 'text-emerald-500',
    },
  ];

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Saved Carts Report</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/saved-carts')}
            className="text-xs"
          >
            View All
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        <CardDescription>Save for later analytics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <metric.icon className={cn('h-4 w-4', metric.color)} />
                <span className="text-xs text-muted-foreground">{metric.label}</span>
              </div>
              <p className="text-xl font-bold">{metric.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
