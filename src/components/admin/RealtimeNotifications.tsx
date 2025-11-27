import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Bell, Package, CreditCard, XCircle, CheckCircle } from 'lucide-react';

export function RealtimeNotifications() {
  const { toast } = useToast();

  useEffect(() => {
    console.log('Setting up realtime notifications...');

    // Subscribe to order inserts (new orders)
    const orderChannel = supabase
      .channel('order-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          console.log('New order detected:', payload);
          if (payload.new.status !== 'DRAFT') {
            toast({
              title: '🎉 New Order Received!',
              description: `Order ID: ${payload.new.id.slice(0, 8)}... - Amount: $${payload.new.total_usd}`,
              duration: 10000,
            });
            
            // Play notification sound (optional)
            const audio = new Audio('/notification.mp3');
            audio.play().catch(e => console.log('Could not play sound:', e));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          console.log('Order updated:', payload);
          const oldStatus = payload.old.status;
          const newStatus = payload.new.status;
          const orderId = payload.new.id.slice(0, 8);

          // Payment verified
          if (!payload.old.payment_verified_at && payload.new.payment_verified_at) {
            toast({
              title: '💰 Payment Verified',
              description: `Order ${orderId}... payment has been verified`,
              duration: 8000,
            });
          }

          // Order shipped
          if (oldStatus !== 'SHIPPED' && newStatus === 'SHIPPED') {
            toast({
              title: '📦 Order Shipped',
              description: `Order ${orderId}... has been shipped`,
              duration: 8000,
            });
          }

          // Order delivered
          if (oldStatus !== 'COMPLETED' && newStatus === 'COMPLETED') {
            toast({
              title: '✅ Order Delivered',
              description: `Order ${orderId}... has been delivered`,
              duration: 8000,
            });
          }

          // Order cancelled
          if (oldStatus !== 'CANCELLED' && newStatus === 'CANCELLED') {
            toast({
              title: '❌ Order Cancelled',
              description: `Order ${orderId}... has been cancelled`,
              duration: 8000,
              variant: 'destructive',
            });
          }

          // Status changed from PAID to PROCESSING
          if (oldStatus === 'PAID' && newStatus === 'PROCESSING') {
            toast({
              title: '⚙️ Order Processing Started',
              description: `Order ${orderId}... is now being processed`,
              duration: 8000,
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    return () => {
      console.log('Cleaning up realtime notifications...');
      supabase.removeChannel(orderChannel);
    };
  }, [toast]);

  return null; // This is a utility component with no UI
}
