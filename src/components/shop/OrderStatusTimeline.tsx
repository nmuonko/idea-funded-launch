import { CheckCircle2, Clock, Package, Truck, XCircle, CircleDollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

type OrderStatus = 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface OrderStatusTimelineProps {
  status: OrderStatus;
  className?: string;
}

interface StatusStep {
  key: OrderStatus;
  labelKey: string;
  defaultLabel: string;
  icon: React.ReactNode;
}

const steps: StatusStep[] = [
  { key: 'paid', labelKey: 'statusPaid', defaultLabel: 'Paid', icon: <CircleDollarSign className="h-4 w-4" /> },
  { key: 'processing', labelKey: 'statusProcessing', defaultLabel: 'Processing', icon: <Package className="h-4 w-4" /> },
  { key: 'shipped', labelKey: 'statusShipped', defaultLabel: 'Shipped', icon: <Truck className="h-4 w-4" /> },
  { key: 'delivered', labelKey: 'statusDelivered', defaultLabel: 'Delivered', icon: <CheckCircle2 className="h-4 w-4" /> },
];

const statusColors: Record<OrderStatus, { bg: string; text: string; border: string }> = {
  pending: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  paid: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  processing: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  shipped: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  delivered: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
};

export function OrderStatusTimeline({ status, className }: OrderStatusTimelineProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  // Handle cancelled status separately
  if (status === 'cancelled') {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-2">
          <div className={cn('p-2 rounded-full', statusColors.cancelled.bg)}>
            <XCircle className={cn('h-5 w-5', statusColors.cancelled.text)} />
          </div>
          <span className={cn('font-medium', statusColors.cancelled.text)}>
            {shop.statusCancelled || 'Cancelled'}
          </span>
        </div>
      </div>
    );
  }

  // Handle pending status
  if (status === 'pending') {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-2">
          <div className={cn('p-2 rounded-full', statusColors.pending.bg)}>
            <Clock className={cn('h-5 w-5', statusColors.pending.text)} />
          </div>
          <span className={cn('font-medium', statusColors.pending.text)}>
            {shop.statusPending || 'Awaiting Payment'}
          </span>
        </div>
      </div>
    );
  }

  // Get current step index
  const currentStepIndex = steps.findIndex(s => s.key === status);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Progress Bar */}
      <div className="relative">
        <div className="absolute top-4 left-0 right-0 h-1 bg-white/10 rounded-full" />
        <div 
          className="absolute top-4 left-0 h-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
          style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
        />
        
        {/* Steps */}
        <div className="relative flex justify-between">
          {steps.map((step, index) => {
            const isCompleted = index <= currentStepIndex;
            const isCurrent = index === currentStepIndex;
            
            return (
              <div key={step.key} className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                    isCompleted
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                      : 'bg-white/10 text-white/40'
                  )}
                >
                  {step.icon}
                </div>
                <span
                  className={cn(
                    'text-xs mt-2 text-center',
                    isCurrent ? 'text-white font-medium' : isCompleted ? 'text-white/70' : 'text-white/40'
                  )}
                >
                  {(shop as any)[step.labelKey] || step.defaultLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  const statusLabels: Record<OrderStatus, string> = {
    pending: shop.statusPending || 'Pending',
    paid: shop.statusPaid || 'Paid',
    processing: shop.statusProcessing || 'Processing',
    shipped: shop.statusShipped || 'Shipped',
    delivered: shop.statusDelivered || 'Delivered',
    cancelled: shop.statusCancelled || 'Cancelled',
  };

  const statusIcons: Record<OrderStatus, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    paid: <CheckCircle2 className="h-3 w-3" />,
    processing: <Package className="h-3 w-3" />,
    shipped: <Truck className="h-3 w-3" />,
    delivered: <CheckCircle2 className="h-3 w-3" />,
    cancelled: <XCircle className="h-3 w-3" />,
  };

  const colors = statusColors[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border',
        colors.bg,
        colors.text,
        colors.border
      )}
    >
      {statusIcons[status]}
      {statusLabels[status]}
    </span>
  );
}
