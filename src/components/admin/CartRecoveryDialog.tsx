import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, Eye, Bell, Users, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

interface CartRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const THRESHOLD_OPTIONS = [
  { value: '2', label: '2 heures / 2 hours' },
  { value: '6', label: '6 heures / 6 hours' },
  { value: '12', label: '12 heures / 12 hours' },
  { value: '24', label: '24 heures / 1 day' },
  { value: '48', label: '48 heures / 2 days' },
  { value: '72', label: '72 heures / 3 days' },
];

const LANGUAGE_OPTIONS = [
  { value: 'fr', label: '🇫🇷 Français' },
  { value: 'en', label: '🇺🇸 English' },
  { value: 'sw', label: '🇨🇩 Swahili' },
  { value: 'ln', label: '🇨🇩 Lingala' },
];

export function CartRecoveryDialog({ open, onOpenChange }: CartRecoveryDialogProps) {
  const { toast } = useToast();
  const { language: appLang } = useLanguage();
  const [hoursThreshold, setHoursThreshold] = useState('48');
  const [emailLanguage, setEmailLanguage] = useState('fr');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handlePreview = async () => {
    try {
      setPreviewing(true);
      setPreviewCount(null);
      setPreviewHtml(null);

      // Fetch count and sample HTML in parallel
      const [countRes, htmlRes] = await Promise.all([
        supabase.functions.invoke('email-service', {
          body: {
            type: 'abandoned_cart_recovery',
            hoursThreshold: Number(hoursThreshold),
            language: emailLanguage,
            preview: true,
          },
        }),
        supabase.functions.invoke('email-service', {
          body: {
            type: 'abandoned_cart_recovery',
            language: emailLanguage,
            preview_html: true,
          },
        }),
      ]);

      if (countRes.error) throw countRes.error;
      if (htmlRes.error) throw htmlRes.error;

      setPreviewCount(countRes.data?.count ?? 0);
      setPreviewHtml(htmlRes.data?.html || null);
    } catch (err: any) {
      toast({
        title: appLang === 'fr' ? 'Erreur' : 'Error',
        description: err.message || 'Failed to preview',
        variant: 'destructive',
      });
    } finally {
      setPreviewing(false);
    }
  };

  const handleOpenInNewTab = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleSend = async () => {
    try {
      setSending(true);
      const { data, error } = await supabase.functions.invoke('email-service', {
        body: {
          type: 'abandoned_cart_recovery',
          hoursThreshold: Number(hoursThreshold),
          language: emailLanguage,
          preview: false,
        },
      });
      if (error) throw error;
      toast({
        title: appLang === 'fr' ? 'Rappels envoyés ✅' : 'Reminders sent ✅',
        description: appLang === 'fr'
          ? `${data?.sent || 0} email(s) envoyé(s), ${data?.skipped || 0} ignoré(s)`
          : `${data?.sent || 0} email(s) sent, ${data?.skipped || 0} skipped`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: appLang === 'fr' ? 'Erreur' : 'Error',
        description: err.message || 'Failed to send reminders',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" />
            {appLang === 'fr' ? 'Rappel de panier abandonné' : 'Cart Recovery Reminder'}
          </DialogTitle>
          <DialogDescription>
            {appLang === 'fr'
              ? 'Envoyez un email de rappel aux clients dont le paiement n\'est pas finalisé.'
              : 'Send a reminder email to customers with unfinished payments.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Time threshold */}
          <div className="space-y-2">
            <Label>
              {appLang === 'fr' ? 'Commandes inactives depuis' : 'Orders inactive for'}
            </Label>
            <Select value={hoursThreshold} onValueChange={(v) => { setHoursThreshold(v); setPreviewCount(null); setPreviewHtml(null); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label>
              {appLang === 'fr' ? 'Langue de l\'email' : 'Email language'}
            </Label>
            <Select value={emailLanguage} onValueChange={(v) => { setEmailLanguage(v); setPreviewHtml(null); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview result - count */}
          {previewCount !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3">
              <Users className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium">
                <Badge variant="secondary" className="mr-2 text-base">{previewCount}</Badge>
                {appLang === 'fr'
                  ? `client(s) éligible(s) recevront un rappel`
                  : `eligible customer(s) will receive a reminder`}
              </span>
            </div>
          )}

          {/* Email HTML preview */}
          {previewHtml && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {appLang === 'fr' ? 'Aperçu de l\'email' : 'Email Preview'}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  className="gap-1 text-xs h-7"
                >
                  <ExternalLink className="h-3 w-3" />
                  {appLang === 'fr' ? 'Ouvrir dans un nouvel onglet' : 'Open in new tab'}
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden bg-white">
                <iframe
                  ref={iframeRef}
                  srcDoc={previewHtml}
                  className="w-full h-[400px] border-0"
                  sandbox="allow-same-origin"
                  title="Email preview"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewing || sending}
            className="gap-2"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {appLang === 'fr' ? 'Prévisualiser' : 'Preview'}
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || previewing}
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {appLang === 'fr' ? 'Envoyer les rappels' : 'Send Reminders'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
