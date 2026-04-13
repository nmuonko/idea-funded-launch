import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUSD } from '@/lib/formatCurrency';
import { DollarSign, TrendingUp, XCircle, Clock, CheckCircle, BarChart3 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type StatusFilter = 'all' | 'paid' | 'pending' | 'cancelled';

interface ProfitByStatus {
  status: StatusFilter;
  label: string;
  orderCount: number;
  totalMarkup: number;
  totalServiceFee: number;
  totalProfit: number;
}

async function loadProfitStats(): Promise<ProfitByStatus[]> {
  // Fetch all non-draft orders
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, status, service_fee_usd, payment_verified_at')
    .neq('status', 'DRAFT');

  if (ordersErr) throw ordersErr;
  if (!orders?.length) return buildEmpty();

  // Categorize orders
  const paidIds: string[] = [];
  const pendingIds: string[] = [];
  const cancelledIds: string[] = [];

  for (const o of orders) {
    if (o.payment_verified_at) paidIds.push(o.id);
    else if (o.status === 'PENDING_PAYMENT') pendingIds.push(o.id);
    else if (o.status === 'CANCELLED') cancelledIds.push(o.id);
    else paidIds.push(o.id); // APPROVED, SHIPPED, DELIVERED → paid bucket
  }

  // Fetch markup fees per bucket in parallel
  const fetchMarkup = async (ids: string[]) => {
    if (!ids.length) return { markup: 0, serviceFee: 0 };
    const { data } = await supabase.from('order_items').select('markup_fee_usd, order_id').in('order_id', ids);
    const markup = (data || []).reduce((s, i) => s + Number(i.markup_fee_usd || 0), 0);
    const matchedOrders = orders.filter(o => ids.includes(o.id));
    const serviceFee = matchedOrders.reduce((s, o) => s + Number(o.service_fee_usd || 0), 0);
    return { markup, serviceFee };
  };

  const [paid, pending, cancelled] = await Promise.all([
    fetchMarkup(paidIds),
    fetchMarkup(pendingIds),
    fetchMarkup(cancelledIds),
  ]);

  return [
    {
      status: 'all',
      label: 'All Orders',
      orderCount: orders.length,
      totalMarkup: paid.markup + pending.markup + cancelled.markup,
      totalServiceFee: paid.serviceFee + pending.serviceFee + cancelled.serviceFee,
      totalProfit: paid.markup + pending.markup + cancelled.markup + paid.serviceFee + pending.serviceFee + cancelled.serviceFee,
    },
    {
      status: 'paid',
      label: 'Paid / Confirmed',
      orderCount: paidIds.length,
      totalMarkup: paid.markup,
      totalServiceFee: paid.serviceFee,
      totalProfit: paid.markup + paid.serviceFee,
    },
    {
      status: 'pending',
      label: 'Pending Payment',
      orderCount: pendingIds.length,
      totalMarkup: pending.markup,
      totalServiceFee: pending.serviceFee,
      totalProfit: pending.markup + pending.serviceFee,
    },
    {
      status: 'cancelled',
      label: 'Cancelled',
      orderCount: cancelledIds.length,
      totalMarkup: cancelled.markup,
      totalServiceFee: cancelled.serviceFee,
      totalProfit: cancelled.markup + cancelled.serviceFee,
    },
  ];
}

function buildEmpty(): ProfitByStatus[] {
  return ['all', 'paid', 'pending', 'cancelled'].map(s => ({
    status: s as StatusFilter,
    label: s === 'all' ? 'All Orders' : s === 'paid' ? 'Paid / Confirmed' : s === 'pending' ? 'Pending Payment' : 'Cancelled',
    orderCount: 0, totalMarkup: 0, totalServiceFee: 0, totalProfit: 0,
  }));
}

const statusIcons: Record<StatusFilter, typeof DollarSign> = {
  all: BarChart3,
  paid: CheckCircle,
  pending: Clock,
  cancelled: XCircle,
};

const statusColors: Record<StatusFilter, string> = {
  all: 'text-primary',
  paid: 'text-emerald-500',
  pending: 'text-yellow-500',
  cancelled: 'text-destructive',
};

export function ProfitStatsTab({ embedded }: { embedded?: boolean }) {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'profit-stats'],
    queryFn: loadProfitStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const buckets = stats || buildEmpty();
  const active = buckets.find(b => b.status === filter) || buckets[0];
  const Icon = statusIcons[filter];

  return (
    <div className="space-y-5">
      {/* Status filter toggle */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => v && setFilter(v as StatusFilter)}
        className="flex flex-wrap gap-2"
      >
        {buckets.map(b => {
          const BIcon = statusIcons[b.status];
          return (
            <ToggleGroupItem
              key={b.status}
              value={b.status}
              className="gap-1.5 text-xs px-3 py-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <BIcon className="h-3.5 w-3.5" />
              {b.label}
              <span className="ml-1 font-semibold">({b.orderCount})</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {/* Profit cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Markup Profit</span>
          </div>
          <p className={`text-2xl font-bold ${statusColors[filter]}`}>
            {formatUSD(active.totalMarkup)}
          </p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Service Fees</span>
          </div>
          <p className={`text-2xl font-bold ${statusColors[filter]}`}>
            {formatUSD(active.totalServiceFee)}
          </p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total Profit</span>
          </div>
          <p className={`text-2xl font-bold ${statusColors[filter]}`}>
            {formatUSD(active.totalProfit)}
          </p>
        </div>
      </div>

      {/* Comparison table */}
      <div className="rounded-lg border border-border/40 bg-card/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/30 text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-right px-4 py-2.5 font-medium">Orders</th>
              <th className="text-right px-4 py-2.5 font-medium">Markup</th>
              <th className="text-right px-4 py-2.5 font-medium">Fees</th>
              <th className="text-right px-4 py-2.5 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.filter(b => b.status !== 'all').map(b => {
              const RowIcon = statusIcons[b.status];
              return (
                <tr
                  key={b.status}
                  className={`border-b border-border/20 last:border-0 cursor-pointer hover:bg-muted/30 transition-colors ${filter === b.status ? 'bg-muted/40' : ''}`}
                  onClick={() => setFilter(b.status)}
                >
                  <td className="px-4 py-3 flex items-center gap-2">
                    <RowIcon className={`h-4 w-4 ${statusColors[b.status]}`} />
                    <span className="font-medium">{b.label}</span>
                  </td>
                  <td className="text-right px-4 py-3">{b.orderCount}</td>
                  <td className="text-right px-4 py-3">{formatUSD(b.totalMarkup)}</td>
                  <td className="text-right px-4 py-3">{formatUSD(b.totalServiceFee)}</td>
                  <td className="text-right px-4 py-3 font-semibold">{formatUSD(b.totalProfit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
