import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Package,
  CreditCard,
  CheckCircle,
  XCircle,
  AlertCircle,
  User,
  MessageSquare,
  MousePointerClick,
  Clock,
  Mail,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface OrderTimelineProps {
  orderId: string;
}

type EventType =
  | 'status_change'
  | 'payment_attempt'
  | 'payment'
  | 'payment_failed'
  | 'funnel'
  | 'cta'
  | 'action'
  | 'reminder'
  | 'note';

interface TimelineEvent {
  id: string;
  type: EventType;
  timestamp: string;
  title: string;
  description: string;
  provider?: string;
  status?: string;
  metadata?: Record<string, any>;
}

const STEP_LABEL: Record<string, string> = {
  cart_opened: 'Opened cart',
  checkout_started: 'Started checkout',
  shipping_filled: 'Filled shipping info',
  payment_method_selected: 'Selected payment method',
  payment_initiated: 'Initiated payment',
  otp_requested: 'Requested OTP / PIN',
  otp_submitted: 'Submitted OTP / PIN',
  payment_submitted: 'Submitted payment',
  payment_confirmed: 'Payment confirmed',
  payment_failed: 'Payment failed',
  payment_cancelled: 'Cancelled payment',
  abandoned: 'Abandoned checkout',
};

function labelStep(step: string) {
  return STEP_LABEL[step] || step.replace(/_/g, ' ');
}

export function OrderTimelineComponent({ orderId }: OrderTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{
    lastStep: string;
    lastAt: string;
    attempts: number;
    succeeded: boolean;
    diagnosis: string;
  } | null>(null);

  useEffect(() => {
    if (orderId) loadTimeline();
  }, [orderId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);

      const [
        { data: order },
        { data: actions },
        { data: attempts },
        { data: payments },
        { data: funnel },
        { data: ctas },
        { data: reminders },
      ] = await Promise.all([
        supabase.from('orders').select('*').eq('id', orderId).single(),
        supabase.from('order_actions').select('*').eq('order_id', orderId),
        supabase.from('payment_attempts').select('*').eq('order_id', orderId),
        supabase.from('payments').select('*').eq('order_id', orderId),
        supabase.from('checkout_funnel_log').select('*').eq('order_id', orderId),
        supabase.from('payment_cta_clicks').select('*').eq('order_id', orderId),
        supabase.from('payment_pending_reminders').select('*').eq('order_id', orderId),
      ]);

      const timeline: TimelineEvent[] = [];

      if (order) {
        timeline.push({
          id: 'created',
          type: 'status_change',
          timestamp: order.created_at,
          title: 'Order created',
          description: `Status: ${order.status}`,
        });
        if (order.payment_verified_at) {
          timeline.push({
            id: 'payment_verified',
            type: 'payment',
            timestamp: order.payment_verified_at,
            title: 'Payment verified',
            description: `Via ${order.payment_verification_method || 'system'}`,
          });
        }
        if (order.shipped_at) {
          timeline.push({
            id: 'shipped',
            type: 'status_change',
            timestamp: order.shipped_at,
            title: 'Shipped',
            description: order.tracking_number
              ? `${order.tracking_number} via ${order.carrier || 'carrier'}`
              : 'Marked shipped',
          });
        }
        if (order.delivered_at) {
          timeline.push({
            id: 'delivered',
            type: 'status_change',
            timestamp: order.delivered_at,
            title: 'Delivered',
            description: 'Order delivered',
          });
        }
        if (order.rejected_at) {
          timeline.push({
            id: 'rejected',
            type: 'action',
            timestamp: order.rejected_at,
            title: 'Order rejected',
            description: order.rejection_reason || 'Rejected by admin',
          });
        }
      }

      (funnel || []).forEach((f) => {
        timeline.push({
          id: `funnel-${f.id}`,
          type: 'funnel',
          timestamp: f.created_at,
          title: labelStep(f.step),
          description:
            f.status === 'ok'
              ? 'User reached this step'
              : f.error_message || `Status: ${f.status}`,
          status: f.status,
          metadata:
            f.metadata && typeof f.metadata === 'object' && !Array.isArray(f.metadata)
              ? (f.metadata as Record<string, any>)
              : undefined,
        });
      });

      (attempts || []).forEach((a) => {
        const failed = ['failed', 'expired', 'cancelled'].includes(a.status);
        timeline.push({
          id: `att-${a.id}`,
          type: failed ? 'payment_failed' : 'payment_attempt',
          timestamp: a.created_at,
          title: failed
            ? `Payment ${a.status} (${a.provider || 'unknown'})`
            : `Payment ${a.status} (${a.provider || 'unknown'})`,
          description: a.last_error
            ? `Reason: ${a.last_error}`
            : `Method: ${a.payment_method || 'n/a'} · Amount: ${a.amount} ${a.currency}`,
          provider: a.provider,
          status: a.status,
          metadata: { attempt: a.attempt_count, ref: a.provider_ref },
        });
      });

      (payments || []).forEach((p) => {
        const failed = ['failed', 'cancelled'].includes(p.status || '');
        timeline.push({
          id: `pay-${p.id}`,
          type: failed ? 'payment_failed' : 'payment',
          timestamp: p.created_at || p.updated_at,
          title: `${p.provider_key} · ${p.status}`,
          description: p.failure_reason
            ? `Failure: ${p.failure_reason}${p.failure_code ? ` (${p.failure_code})` : ''}`
            : `Amount: ${p.amount} ${p.currency} · Ref: ${p.reference}`,
          provider: p.provider_key,
          status: p.status,
        });
        if (p.paid_at) {
          timeline.push({
            id: `pay-paid-${p.id}`,
            type: 'payment',
            timestamp: p.paid_at,
            title: `${p.provider_key} paid`,
            description: `Confirmed at ${new Date(p.paid_at).toLocaleString()}`,
          });
        }
      });

      (ctas || []).forEach((c) => {
        timeline.push({
          id: `cta-${c.id}`,
          type: 'cta',
          timestamp: c.created_at,
          title: `Clicked: ${c.cta_type.replace(/_/g, ' ')}`,
          description: `Channel: ${c.channel}${c.amount_usd ? ` · $${c.amount_usd}` : ''}`,
        });
      });

      (reminders || []).forEach((r: any) => {
        timeline.push({
          id: `rem-${r.id}`,
          type: 'reminder',
          timestamp: r.sent_at || r.created_at,
          title: `Reminder sent (${r.reminder_type || 'pending payment'})`,
          description: r.channel ? `Via ${r.channel}` : 'Email reminder sent to customer',
        });
      });

      (actions || []).forEach((a) => {
        timeline.push({
          id: `act-${a.id}`,
          type: 'action',
          timestamp: a.created_at,
          title: a.action_type.replace(/_/g, ' '),
          description: a.action_message || 'Admin action',
        });
      });

      timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(timeline);

      // ---------- Build "where did they stop?" summary ----------
      const attemptCount = attempts?.length || 0;
      const paymentRows = payments || [];
      const ctaCount = ctas?.length || 0;
      const paymentFunnelSteps = (funnel || []).filter((f) =>
        ['payment_method_selected', 'payment_initiated', 'otp_requested', 'otp_submitted', 'payment_submitted', 'payment_confirmed', 'payment_failed', 'payment_cancelled'].includes(f.step) ||
        f.step?.startsWith('payment'),
      );
      const anySuccess =
        paymentRows.some((p) => p.status === 'succeeded' || p.paid_at) ||
        (attempts || []).some((a) => a.status === 'paid') ||
        !!order?.payment_verified_at;

      // Anything that proves the customer DID try to pay (not just reached checkout)
      const initiated =
        attemptCount > 0 ||
        paymentRows.length > 0 ||
        paymentFunnelSteps.length > 0 ||
        ctaCount > 0;

      // Last meaningful step
      const ordered = [...timeline].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      const last = ordered[ordered.length - 1];

      let diagnosis = '';
      if (anySuccess) {
        diagnosis = '✅ Payment was confirmed for this order.';
      } else if (!initiated) {
        diagnosis =
          '🟡 No payment activity recorded. Customer reached checkout but no payment attempt, CTA click, or provider call was logged.';
      } else {
        const lastAttempt = (attempts || []).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0];
        const lastPayment = paymentRows.sort(
          (a, b) => new Date(b.created_at || b.updated_at).getTime() - new Date(a.created_at || a.updated_at).getTime(),
        )[0];
        if (lastAttempt?.status === 'expired') {
          diagnosis = `⏰ Customer initiated payment but the attempt expired on ${lastAttempt.provider || 'provider'} before completion.`;
        } else if (lastAttempt?.status === 'cancelled') {
          diagnosis = `🚫 Customer initiated payment then cancelled on ${lastAttempt.provider || 'provider'}.`;
        } else if (lastAttempt?.status === 'failed' || lastPayment?.status === 'failed') {
          const err = lastAttempt?.last_error || lastPayment?.failure_reason;
          diagnosis = `❌ Customer initiated payment but it failed${err ? `: ${err}` : ''}.`;
        } else if (
          lastAttempt?.status === 'pending' ||
          lastAttempt?.status === 'processing' ||
          lastPayment?.status === 'pending' ||
          lastPayment?.status === 'processing'
        ) {
          diagnosis = `⌛ Customer initiated payment on ${lastAttempt?.provider || lastPayment?.provider_key || 'provider'} but did not complete it (still ${lastAttempt?.status || lastPayment?.status} — likely abandoned mid-flow).`;
        } else if (ctaCount > 0 && attemptCount === 0 && paymentRows.length === 0) {
          diagnosis = '🟡 Customer clicked the pay CTA but never reached the provider to submit a payment.';
        } else {
          diagnosis = '🟡 Customer initiated payment but never completed it.';
        }
      }


      setSummary({
        lastStep: last?.title || 'No activity recorded',
        lastAt: last?.timestamp || order?.created_at,
        attempts: attemptCount,
        succeeded: anySuccess,
        diagnosis,
      });
    } catch (e) {
      console.error('Error loading timeline:', e);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: EventType) => {
    switch (type) {
      case 'status_change':
        return <Package className="h-3.5 w-3.5" />;
      case 'payment':
        return <CheckCircle className="h-3.5 w-3.5" />;
      case 'payment_attempt':
        return <CreditCard className="h-3.5 w-3.5" />;
      case 'payment_failed':
        return <XCircle className="h-3.5 w-3.5" />;
      case 'funnel':
        return <Clock className="h-3.5 w-3.5" />;
      case 'cta':
        return <MousePointerClick className="h-3.5 w-3.5" />;
      case 'reminder':
        return <Mail className="h-3.5 w-3.5" />;
      case 'action':
        return <User className="h-3.5 w-3.5" />;
      case 'note':
        return <MessageSquare className="h-3.5 w-3.5" />;
      default:
        return <AlertCircle className="h-3.5 w-3.5" />;
    }
  };

  const getEventColor = (type: EventType) => {
    switch (type) {
      case 'status_change':
        return 'bg-blue-500';
      case 'payment':
        return 'bg-green-500';
      case 'payment_attempt':
        return 'bg-amber-500';
      case 'payment_failed':
        return 'bg-red-500';
      case 'funnel':
        return 'bg-indigo-500';
      case 'cta':
        return 'bg-purple-500';
      case 'reminder':
        return 'bg-cyan-500';
      case 'action':
        return 'bg-slate-500';
      default:
        return 'bg-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <Card className={summary.succeeded ? 'border-green-500/40' : 'border-amber-500/40'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Where did the customer stop?</CardTitle>
            <CardDescription className="text-xs">
              Reconstructed from clicks, checkout steps and payment attempts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{summary.diagnosis}</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Last activity: </span>
                {summary.lastStep}
              </div>
              <div>
                <span className="font-medium text-foreground">When: </span>
                {summary.lastAt
                  ? `${formatDistanceToNow(new Date(summary.lastAt), { addSuffix: true })}`
                  : '—'}
              </div>
              <div>
                <span className="font-medium text-foreground">Payment attempts: </span>
                {summary.attempts}
              </div>
              <div>
                <span className="font-medium text-foreground">Paid: </span>
                {summary.succeeded ? 'Yes' : 'No'}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground pl-10">No activity recorded yet.</p>
          )}
          {events.map((event) => (
            <div key={event.id} className="relative flex gap-3">
              <div
                className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full ${getEventColor(
                  event.type,
                )} text-white shrink-0`}
              >
                {getEventIcon(event.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-medium text-sm capitalize">{event.title}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">
                      {event.description}
                    </p>
                    {event.status && (
                      <Badge variant="outline" className="text-[10px] mt-1">
                        {event.status}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {format(new Date(event.timestamp), 'MMM dd, HH:mm')}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
