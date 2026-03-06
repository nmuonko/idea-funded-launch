import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mail, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SingleOrderProps {
  orderId: string;
  customerEmail: string;
  customerName: string;
  orderIds?: never;
}

interface BatchOrderProps {
  orderIds: string[];
  orderId?: never;
  customerEmail?: never;
  customerName?: never;
}

type SendOrderEmailDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
} & (SingleOrderProps | BatchOrderProps);

export function SendOrderEmailDialog(props: SendOrderEmailDialogProps) {
  const { open, onClose, onSuccess } = props;
  const isBatchMode = 'orderIds' in props && props.orderIds !== undefined;
  
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [templateType, setTemplateType] = useState<string>('order_confirmed');
  const [customSubject, setCustomSubject] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 });

  const handleSendEmail = async () => {
    try {
      setSending(true);

      if (isBatchMode) {
        const orderIds = props.orderIds;
        setProgress({ sent: 0, failed: 0, total: orderIds.length });
        
        let sent = 0;
        let failed = 0;

        for (const orderId of orderIds) {
          try {
            const { error } = await supabase.functions.invoke('email-service', {
              body: {
                type: 'order_email',
                orderId,
                templateType,
                customSubject: templateType === 'custom' ? customSubject : undefined,
                customMessage: templateType === 'custom' ? customMessage : undefined,
              },
            });

            if (error) {
              console.error(`Failed to send email for order ${orderId}:`, error);
              failed++;
            } else {
              sent++;
            }
          } catch (error) {
            console.error(`Error sending email for order ${orderId}:`, error);
            failed++;
          }

          setProgress({ sent, failed, total: orderIds.length });
        }

        if (failed === 0) {
          toast({
            title: 'Emails sent',
            description: `Successfully sent ${sent} email(s)`,
          });
          onSuccess?.();
          onClose();
        } else {
          toast({
            title: 'Partial success',
            description: `Sent ${sent}, failed ${failed} email(s)`,
            variant: failed === orderIds.length ? 'destructive' : 'default',
          });
        }
      } else {
        const { error } = await supabase.functions.invoke('email-service', {
          body: {
            type: 'order_email',
            orderId: props.orderId,
            templateType,
            customSubject: templateType === 'custom' ? customSubject : undefined,
            customMessage: templateType === 'custom' ? customMessage : undefined,
          },
        });

        if (error) throw error;

        toast({
          title: 'Email sent successfully',
          description: `Notification sent to ${props.customerEmail}`,
        });

        onSuccess?.();
        onClose();
      }

      setTemplateType('order_confirmed');
      setCustomSubject('');
      setCustomMessage('');
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast({
        title: 'Error sending email',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
      setProgress({ sent: 0, failed: 0, total: 0 });
    }
  };

  const templates = [
    { value: 'order_confirmed', label: 'Order Confirmation', description: 'Confirm order received' },
    { value: 'payment_verified', label: 'Payment Verified', description: 'Payment successfully verified' },
    { value: 'order_shipped', label: 'Order Shipped', description: 'Order shipped notification' },
    { value: 'order_delivered', label: 'Order Delivered', description: 'Delivery confirmation' },
    { value: 'custom', label: 'Custom Message', description: 'Send custom email' },
  ];

  const orderCount = isBatchMode ? props.orderIds.length : 1;
  const description = isBatchMode 
    ? `Send email notifications to ${orderCount} selected order(s)`
    : `Send automated or custom email notifications to ${props.customerName} (${props.customerEmail})`;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {isBatchMode ? 'Send Batch Email' : 'Send Order Email'}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Email Template</Label>
            <Select value={templateType} onValueChange={setTemplateType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.value} value={template.value}>
                    <div>
                      <div className="font-medium">{template.label}</div>
                      <div className="text-xs text-muted-foreground">{template.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templateType === 'custom' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  placeholder="Enter email subject"
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  placeholder="Enter your custom message"
                  rows={6}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                />
              </div>
            </>
          )}

          {templateType !== 'custom' && (
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm text-muted-foreground">
                This will send an automated email with order details, status updates, and relevant information
                based on the selected template.
              </p>
            </div>
          )}

          {sending && isBatchMode && (
            <div className="bg-muted rounded-lg p-3">
              <div className="text-sm text-muted-foreground mb-2">
                Sending emails... {progress.sent + progress.failed} / {progress.total}
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-600">✓ Sent: {progress.sent}</span>
                {progress.failed > 0 && (
                  <span className="text-destructive">✗ Failed: {progress.failed}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSendEmail} 
            disabled={sending || (templateType === 'custom' && (!customSubject || !customMessage)) || orderCount === 0}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                {isBatchMode ? `Send to ${orderCount} Order(s)` : 'Send Email'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
