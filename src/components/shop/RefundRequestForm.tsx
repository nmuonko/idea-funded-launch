import { useState, useEffect } from 'react';
import { Loader2, Send, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

const REASONS = [
  { value: 'failed_fulfillment', en: 'Failed fulfillment / logistics issue', fr: 'Échec de livraison / problème logistique' },
  { value: 'order_cancelled', en: 'Order cancelled before completion', fr: 'Commande annulée avant finalisation' },
  { value: 'payment_error', en: 'Payment error / duplicate charge', fr: 'Erreur de paiement / double charge' },
  { value: 'item_different', en: 'Item significantly different from description', fr: 'Article très différent de la description' },
  { value: 'damaged_goods', en: 'Damaged goods received', fr: 'Produit reçu endommagé' },
  { value: 'other', en: 'Other', fr: 'Autre' },
];

export function RefundRequestForm() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [orders, setOrders] = useState<Array<{ id: string; created_at: string }>>([]);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('orders')
      .select('id, created_at')
      .eq('user_id', user.id)
      .in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'])
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setOrders((data || []) as Array<{ id: string; created_at: string }>);
        setLoadingOrders(false);
      });
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !reason) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('refund_requests').insert({
        user_id: user.id,
        order_id: selectedOrder || null,
        reason,
        details: details.trim() || null,
      });
      if (error) throw error;
      setSubmitted(true);
      toast.success(language === 'fr' ? 'Demande envoyée !' : 'Request submitted!');
    } catch {
      toast.error(language === 'fr' ? 'Échec de l\'envoi' : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-8 text-white/50">
        {language === 'fr' ? 'Connectez-vous pour soumettre une demande' : 'Sign in to submit a request'}
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">
          {language === 'fr' ? 'Demande reçue' : 'Request Received'}
        </h3>
        <p className="text-white/60 text-sm">
          {language === 'fr'
            ? 'Notre équipe examinera votre demande dans les 1 à 3 jours ouvrables.'
            : 'Our team will review your request within 1-3 business days.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label className="text-white/70">
          {language === 'fr' ? 'Commande (optionnel)' : 'Order (optional)'}
        </Label>
        {loadingOrders ? (
          <div className="h-10 flex items-center"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
        ) : (
          <Select value={selectedOrder} onValueChange={setSelectedOrder}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
              <SelectValue placeholder={language === 'fr' ? 'Sélectionner une commande' : 'Select an order'} />
            </SelectTrigger>
            <SelectContent>
              {orders.map(o => (
                <SelectItem key={o.id} value={o.id}>
                  {o.id.slice(0, 8)}... — {new Date(o.created_at).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div>
        <Label className="text-white/70">
          {language === 'fr' ? 'Raison *' : 'Reason *'}
        </Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
            <SelectValue placeholder={language === 'fr' ? 'Choisir une raison' : 'Select a reason'} />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map(r => (
              <SelectItem key={r.value} value={r.value}>
                {language === 'fr' ? r.fr : r.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-white/70">
          {language === 'fr' ? 'Détails' : 'Details'}
        </Label>
        <Textarea
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder={language === 'fr' ? 'Décrivez votre problème...' : 'Describe your issue...'}
          className="bg-white/5 border-white/10 text-white mt-1 min-h-[100px]"
          maxLength={2000}
        />
      </div>

      <Button
        type="submit"
        disabled={submitting || !reason}
        className="w-full bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white rounded-full"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Send className="h-4 w-4 mr-2" />
        )}
        {language === 'fr' ? 'Soumettre la demande' : 'Submit Request'}
      </Button>
    </form>
  );
}
