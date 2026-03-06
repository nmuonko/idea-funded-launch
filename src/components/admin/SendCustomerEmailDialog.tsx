import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Mail, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface SendCustomerEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerEmail: string;
  customerName: string | null;
}

const EMAIL_TEMPLATES = [
  {
    id: 'welcome',
    name: 'Welcome',
    nameFr: 'Bienvenue',
    subject: 'Welcome to AfriShop!',
    subjectFr: 'Bienvenue chez AfriShop!',
    body: `Dear {name},

Welcome to AfriShop! We're excited to have you as part of our community.

With AfriShop, you can shop from top US retailers like Amazon, eBay, Walmart, and more, and have your items delivered right to your doorstep in the DRC.

If you have any questions, don't hesitate to reach out to our support team.

Happy shopping!

Best regards,
The AfriShop Team`,
    bodyFr: `Cher(e) {name},

Bienvenue chez AfriShop! Nous sommes ravis de vous compter parmi notre communauté.

Avec AfriShop, vous pouvez acheter auprès des meilleurs détaillants américains comme Amazon, eBay, Walmart, et plus encore, et faire livrer vos articles directement chez vous en RDC.

Si vous avez des questions, n'hésitez pas à contacter notre équipe d'assistance.

Bon shopping!

Cordialement,
L'équipe AfriShop`,
  },
  {
    id: 'promotion',
    name: 'Promotion',
    nameFr: 'Promotion',
    subject: 'Special Offer Just for You!',
    subjectFr: 'Offre spéciale rien que pour vous!',
    body: `Dear {name},

We have a special offer just for you!

For a limited time, enjoy exclusive discounts on your next order with AfriShop.

Don't miss out on this opportunity to save on your favorite products from the USA.

Visit our app today to start shopping!

Best regards,
The AfriShop Team`,
    bodyFr: `Cher(e) {name},

Nous avons une offre spéciale rien que pour vous!

Pour une durée limitée, profitez de remises exclusives sur votre prochaine commande avec AfriShop.

Ne manquez pas cette opportunité d'économiser sur vos produits préférés des États-Unis.

Visitez notre application aujourd'hui pour commencer vos achats!

Cordialement,
L'équipe AfriShop`,
  },
  {
    id: 'custom',
    name: 'Custom Message',
    nameFr: 'Message personnalisé',
    subject: '',
    subjectFr: '',
    body: '',
    bodyFr: '',
  },
];

export function SendCustomerEmailDialog({
  open,
  onOpenChange,
  customerId,
  customerEmail,
  customerName,
}: SendCustomerEmailDialogProps) {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const isFrench = language === 'fr';

  const [selectedTemplate, setSelectedTemplate] = useState('custom');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      const subjectText = isFrench ? template.subjectFr : template.subject;
      const bodyText = isFrench ? template.bodyFr : template.body;
      setSubject(subjectText);
      setBody(bodyText.replace('{name}', customerName || 'Customer'));
    }
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error(t.customers?.fillAllFields || 'Please fill in all fields');
      return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('email-service', {
        body: {
          type: 'customer_email',
          customer_id: customerId,
          customer_email: customerEmail,
          subject: subject.trim(),
          body: body.trim(),
        },
      });

      if (response.error) throw response.error;

      toast.success(t.customers?.emailSent || 'Email sent successfully');
      onOpenChange(false);
      setSubject('');
      setBody('');
      setSelectedTemplate('custom');
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error.message || t.customers?.emailError || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t.customers?.sendEmail || 'Send Email'}
          </DialogTitle>
          <DialogDescription>
            {t.customers?.sendEmailTo || 'Send an email to'} {customerName || customerEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t.customers?.template || 'Template'}</Label>
            <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_TEMPLATES.map(template => (
                  <SelectItem key={template.id} value={template.id}>
                    {isFrench ? template.nameFr : template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t.customers?.recipientEmail || 'Recipient'}</Label>
            <Input value={customerEmail} disabled className="bg-muted" />
          </div>

          <div className="space-y-2">
            <Label>{t.customers?.emailSubject || 'Subject'}</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={t.customers?.enterSubject || 'Enter email subject'}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.customers?.emailBody || 'Message'}</Label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={t.customers?.enterMessage || 'Enter your message'}
              rows={8}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {t.common?.cancel || 'Cancel'}
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t.customers?.sending || 'Sending...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {t.customers?.send || 'Send'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
