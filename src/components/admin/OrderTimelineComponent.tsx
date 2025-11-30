import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, CreditCard, Truck, CheckCircle, XCircle, AlertCircle, User, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';

interface OrderTimelineProps {
  orderId: string;
}

interface TimelineEvent {
  id: string;
  type: 'status_change' | 'payment' | 'action' | 'note';
  timestamp: string;
  title: string;
  description: string;
  actor?: string;
  metadata?: any;
}

export function OrderTimelineComponent({ orderId }: OrderTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) {
      loadTimeline();
    }
  }, [orderId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);
      
      // Fetch order actions
      const { data: actions, error: actionsError } = await supabase
        .from('order_actions')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (actionsError) throw actionsError;

      // Fetch order to get status change timestamps
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;

      const timeline: TimelineEvent[] = [];

      // Add order creation
      timeline.push({
        id: 'created',
        type: 'status_change',
        timestamp: order.created_at,
        title: 'Order Created',
        description: 'Order placed by customer',
      });

      // Add payment verification
      if (order.payment_verified_at) {
        timeline.push({
          id: 'payment_verified',
          type: 'payment',
          timestamp: order.payment_verified_at,
          title: 'Payment Verified',
          description: `Verified via ${order.payment_verification_method || 'N/A'}`,
          metadata: { method: order.payment_verification_method },
        });
      }

      // Add approval
      if (order.approved_at) {
        timeline.push({
          id: 'approved',
          type: 'action',
          timestamp: order.approved_at,
          title: 'Order Approved',
          description: 'Order approved for processing',
        });
      }

      // Add rejection
      if (order.rejected_at) {
        timeline.push({
          id: 'rejected',
          type: 'action',
          timestamp: order.rejected_at,
          title: 'Order Rejected',
          description: order.rejection_reason || 'Order rejected by admin',
        });
      }

      // Add shipped
      if (order.shipped_at) {
        timeline.push({
          id: 'shipped',
          type: 'status_change',
          timestamp: order.shipped_at,
          title: 'Order Shipped',
          description: order.tracking_number 
            ? `Tracking: ${order.tracking_number} via ${order.carrier || 'N/A'}`
            : 'Shipped to customer',
          metadata: { tracking: order.tracking_number, carrier: order.carrier },
        });
      }

      // Add delivered
      if (order.delivered_at) {
        timeline.push({
          id: 'delivered',
          type: 'status_change',
          timestamp: order.delivered_at,
          title: 'Order Delivered',
          description: 'Successfully delivered to customer',
        });
      }

      // Add order actions
      (actions || []).forEach((action) => {
        timeline.push({
          id: action.id,
          type: 'action',
          timestamp: action.created_at,
          title: action.action_type.replace(/_/g, ' ').toUpperCase(),
          description: action.action_message || 'Admin action performed',
          metadata: action.metadata,
        });
      });

      // Sort by timestamp descending
      timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setEvents(timeline);
    } catch (error) {
      console.error('Error loading timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'status_change':
        return <Package className="h-4 w-4" />;
      case 'payment':
        return <CreditCard className="h-4 w-4" />;
      case 'action':
        return <User className="h-4 w-4" />;
      case 'note':
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getEventColor = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'status_change':
        return 'bg-blue-500';
      case 'payment':
        return 'bg-green-500';
      case 'action':
        return 'bg-purple-500';
      case 'note':
        return 'bg-gray-500';
      default:
        return 'bg-gray-400';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order Timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Timeline</CardTitle>
        <CardDescription>Chronological history of all order events</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border" />
          
          {/* Timeline events */}
          <div className="space-y-6">
            {events.map((event, index) => (
              <div key={event.id} className="relative flex gap-4">
                {/* Icon */}
                <div className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full ${getEventColor(event.type)} text-white`}>
                  {getEventIcon(event.type)}
                </div>
                
                {/* Content */}
                <div className="flex-1 pb-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-sm">{event.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                      {event.metadata && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(event.metadata).map(([key, value]) => (
                            <Badge key={key} variant="outline" className="text-xs">
                              {key}: {String(value)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
