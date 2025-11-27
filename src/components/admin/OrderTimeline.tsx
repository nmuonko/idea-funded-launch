import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle, MessageSquare, Package, DollarSign, FileText } from 'lucide-react';

interface TimelineItem {
  id: string;
  action_type: string;
  action_message: string;
  created_at: string;
  actor_id: string;
}

interface OrderTimelineProps {
  orderId: string;
}

export function OrderTimeline({ orderId }: OrderTimelineProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTimeline();
  }, [orderId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('order_actions')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTimeline(data || []);
    } catch (error) {
      console.error('Error loading timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (actionType: string) => {
    const icons: Record<string, any> = {
      APPROVED: CheckCircle,
      REJECTED: XCircle,
      INFO_REQUESTED: MessageSquare,
      PAYMENT_VERIFIED: DollarSign,
      SHIPPED: Package,
      DELIVERED: CheckCircle,
      NOTE_ADDED: FileText,
    };
    const Icon = icons[actionType] || FileText;
    return <Icon className="h-4 w-4" />;
  };

  const getActionColor = (actionType: string) => {
    const colors: Record<string, string> = {
      APPROVED: 'text-green-600 bg-green-50 border-green-200',
      REJECTED: 'text-red-600 bg-red-50 border-red-200',
      INFO_REQUESTED: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      PAYMENT_VERIFIED: 'text-blue-600 bg-blue-50 border-blue-200',
      SHIPPED: 'text-purple-600 bg-purple-50 border-purple-200',
      DELIVERED: 'text-green-600 bg-green-50 border-green-200',
      NOTE_ADDED: 'text-gray-600 bg-gray-50 border-gray-200',
    };
    return colors[actionType] || 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const formatActionType = (actionType: string) => {
    return actionType.replace(/_/g, ' ').toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No timeline events yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {timeline.map((item, index) => (
        <div
          key={item.id}
          className={`border rounded-lg p-3 ${getActionColor(item.action_type)}`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {getActionIcon(item.action_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {formatActionType(item.action_type)}
              </p>
              {item.action_message && (
                <p className="text-xs mt-1 opacity-90">
                  {item.action_message}
                </p>
              )}
              <p className="text-xs mt-1 opacity-75">
                {new Date(item.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
