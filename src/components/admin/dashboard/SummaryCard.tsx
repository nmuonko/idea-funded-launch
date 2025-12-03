import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SummaryCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  trend?: number;
  trendLabel?: string;
  isLoading?: boolean;
}

export function SummaryCard({
  title,
  value,
  icon: Icon,
  iconColor = 'text-primary',
  trend,
  trendLabel,
  isLoading,
}: SummaryCardProps) {
  const isPositiveTrend = trend && trend > 0;
  const isNegativeTrend = trend && trend < 0;

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-20 mt-3" />
          <Skeleton className="h-3 w-16 mt-2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all duration-200 hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={cn('p-2 rounded-lg bg-primary/10', iconColor.replace('text-', 'bg-').replace(/\d+$/, '10'))}>
            <Icon className={cn('h-4 w-4', iconColor)} />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold tracking-tight">{value}</p>
        </div>
        {(trend !== undefined || trendLabel) && (
          <div className="flex items-center gap-1 mt-2">
            {trend !== undefined && (
              <>
                {isPositiveTrend && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                {isNegativeTrend && <TrendingDown className="h-3 w-3 text-red-500" />}
                <span
                  className={cn(
                    'text-xs font-medium',
                    isPositiveTrend && 'text-emerald-500',
                    isNegativeTrend && 'text-red-500',
                    !isPositiveTrend && !isNegativeTrend && 'text-muted-foreground'
                  )}
                >
                  {trend > 0 ? '+' : ''}{trend}%
                </span>
              </>
            )}
            {trendLabel && (
              <span className="text-xs text-muted-foreground">{trendLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
