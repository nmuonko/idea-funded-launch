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

interface SendOrderEmailDialogProps {
  orderId: string;
  customerEmail: string;
  customerName: string;
  open: boolean;
  onClose: () => void;
}

export function SendOrderEmailDialog({
  orderId,
  customerEmail,
  customerName,
  open,
  onClose,
}: SendOrderEmailDialogProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [templateType, setTemplateType] = useState<string>('order_confirmed');
  const [customSubject, setCustomSubject] = useState('');
  const [customMessage, setCustomMessage] = useState('');

  const handleSendEmail = async () => {
    try {
      setSending(true);

      const { data, error } = await supabase.functions.invoke('send-order-email', {
        body: {
          orderId,
          templateType,
          customSubject: templateType === 'custom' ? customSubject : undefined,
          customMessage: templateType === 'custom' ? customMessage : undefined,
        },
      });

      if (error) throw error;

      toast({
        title: 'Email sent successfully',
        description: `Notification sent to ${customerEmail}`,
      });

      onClose();
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
    }
  };

  const templates = [
    { value: 'order_confirmed', label: 'Order Confirmation', description: 'Confirm order received' },
    { value: 'payment_verified', label: 'Payment Verified', description: 'Payment successfully verified' },
    { value: 'order_shipped', label: 'Order Shipped', description: 'Order shipped notification' },
    { value: 'order_delivered', label: 'Order Delivered', description: 'Delivery confirmation' },
    { value: 'custom', label: 'Custom Message', description: 'Send custom email' },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Order Email
          </DialogTitle>
          <DialogDescription>
            Send automated or custom email notifications to {customerName} ({customerEmail})
          </DialogDescription>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSendEmail} disabled={sending || (templateType === 'custom' && (!customSubject || !customMessage))}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
