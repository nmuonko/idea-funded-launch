import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Building2, 
  Copy, 
  Check, 
  ExternalLink, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  RefreshCw,
  User,
  DollarSign,
  FileImage
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface TransferSession {
  id: string;
  order_id: string;
  reference: string;
  status: string;
  created_at: string;
  expires_at: string;
  order?: {
    id: string;
    total_usd: number;
    total_cdf: number;
    status: string;
    user_id: string;
    profiles?: {
      full_name: string | null;
      email: string | null;
      phone: string | null;
    };
  };
  proofs?: {
    id: string;
    status: string;
    file_path: string;
    original_filename: string | null;
    created_at: string;
  }[];
}

export function PendingBankTransfersWidget() {
  const { language } = useLanguage();
  const [sessions, setSessions] = useState<TransferSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    session: TransferSession | null;
    action: 'approve' | 'reject';
  }>({ open: false, session: null, action: 'approve' });
  const [adminNotes, setAdminNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const t = {
    title: language === 'fr' ? 'Virements Bancaires en Attente' : 'Pending Bank Transfers',
    noTransfers: language === 'fr' ? 'Aucun virement en attente' : 'No pending transfers',
    reference: language === 'fr' ? 'Référence' : 'Reference',
    customer: language === 'fr' ? 'Client' : 'Customer',
    amount: language === 'fr' ? 'Montant' : 'Amount',
    status: language === 'fr' ? 'Statut' : 'Status',
    proof: language === 'fr' ? 'Preuve' : 'Proof',
    viewProof: language === 'fr' ? 'Voir preuve' : 'View proof',
    confirmPayment: language === 'fr' ? 'Confirmer paiement' : 'Confirm Payment',
    rejectPayment: language === 'fr' ? 'Rejeter' : 'Reject',
    awaitingProof: language === 'fr' ? 'En attente de preuve' : 'Awaiting proof',
    proofReceived: language === 'fr' ? 'Preuve reçue' : 'Proof received',
    confirmTitle: language === 'fr' ? 'Confirmer le paiement' : 'Confirm Payment',
    confirmDesc: language === 'fr' 
      ? 'Êtes-vous sûr de vouloir confirmer ce paiement? Cela marquera la commande comme payée.'
      : 'Are you sure you want to confirm this payment? This will mark the order as paid.',
    rejectTitle: language === 'fr' ? 'Rejeter le paiement' : 'Reject Payment',
    rejectDesc: language === 'fr'
      ? 'Veuillez indiquer la raison du rejet.'
      : 'Please provide a reason for rejection.',
    notes: language === 'fr' ? 'Notes admin' : 'Admin notes',
    cancel: language === 'fr' ? 'Annuler' : 'Cancel',
    confirm: language === 'fr' ? 'Confirmer' : 'Confirm',
    reject: language === 'fr' ? 'Rejeter' : 'Reject',
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      
      // Get active manual transfer sessions
      const { data: transferSessions, error } = await supabase
        .from('manual_transfer_sessions')
        .select(`
          id,
          order_id,
          reference,
          status,
          created_at,
          expires_at
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!transferSessions || transferSessions.length === 0) {
        setSessions([]);
        return;
      }

      // Get order IDs to fetch order + profile data
      const orderIds = transferSessions.map(s => s.order_id);
      
      // Fetch orders with profiles
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id,
          total_usd,
          total_cdf,
          status,
          user_id,
          profiles!orders_user_id_fkey (
            full_name,
            email,
            phone
          )
        `)
        .in('id', orderIds);

      if (ordersError) throw ordersError;

      // Fetch proofs for these sessions
      const { data: proofs, error: proofsError } = await supabase
        .from('manual_transfer_proofs')
        .select('id, session_id, status, file_path, original_filename, created_at')
        .in('session_id', transferSessions.map(s => s.id));

      if (proofsError) throw proofsError;

      // Combine data
      const enrichedSessions: TransferSession[] = transferSessions.map(session => ({
        ...session,
        order: orders?.find(o => o.id === session.order_id) as TransferSession['order'],
        proofs: proofs?.filter(p => p.session_id === session.id) || [],
      }));

      setSessions(enrichedSessions);
    } catch (err) {
      console.error('Error loading transfer sessions:', err);
      toast.error(language === 'fr' ? 'Erreur de chargement' : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    toast.success(language === 'fr' ? 'Copié!' : 'Copied!');
    setTimeout(() => setCopied(null), 2000);
  };

  const handleAction = async () => {
    if (!confirmDialog.session) return;
    
    setProcessing(true);
    try {
      const { session, action } = confirmDialog;
      
      if (action === 'approve') {
        // Mark order as paid
        const { error: orderError } = await supabase
          .from('orders')
          .update({
            status: 'PAID',
            payment_verified_at: new Date().toISOString(),
            payment_verification_method: 'manual_bank_transfer',
            payment_notes: adminNotes || 'Payment confirmed via bank transfer',
          })
          .eq('id', session.order_id);

        if (orderError) throw orderError;

        // Update session status
        const { error: sessionError } = await supabase
          .from('manual_transfer_sessions')
          .update({ status: 'completed' })
          .eq('id', session.id);

        if (sessionError) throw sessionError;

        // Update proof status if exists
        if (session.proofs && session.proofs.length > 0) {
          await supabase
            .from('manual_transfer_proofs')
            .update({ status: 'approved', admin_notes: adminNotes })
            .eq('session_id', session.id);
        }

        toast.success(
          language === 'fr' 
            ? 'Paiement confirmé avec succès' 
            : 'Payment confirmed successfully'
        );
      } else {
        // Reject - update proof status
        if (session.proofs && session.proofs.length > 0) {
          await supabase
            .from('manual_transfer_proofs')
            .update({ status: 'rejected', admin_notes: adminNotes })
            .eq('session_id', session.id);
        }

        toast.success(
          language === 'fr' 
            ? 'Preuve rejetée' 
            : 'Proof rejected'
        );
      }

      setConfirmDialog({ open: false, session: null, action: 'approve' });
      setAdminNotes('');
      await loadSessions();
    } catch (err) {
      console.error('Error processing action:', err);
      toast.error(language === 'fr' ? 'Erreur' : 'Error');
    } finally {
      setProcessing(false);
    }
  };

  const getProofUrl = async (filePath: string) => {
    const { data } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(filePath, 3600);
    return data?.signedUrl;
  };

  const openProof = async (proof: TransferSession['proofs'][0]) => {
    const url = await getProofUrl(proof.file_path);
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error(language === 'fr' ? 'Impossible d\'ouvrir' : 'Unable to open');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {t.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {t.title}
              {sessions.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {sessions.length}
                </Badge>
              )}
            </CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t.noTransfers}
            </p>
          ) : (
            <ScrollArea className="h-[400px] pr-2">
              <div className="space-y-3">
                {sessions.map(session => {
                  const hasProof = session.proofs && session.proofs.length > 0;
                  const pendingProof = session.proofs?.find(p => p.status === 'pending');
                  
                  return (
                    <div 
                      key={session.id} 
                      className="border rounded-lg p-3 space-y-2 bg-card hover:bg-accent/50 transition-colors"
                    >
                      {/* Reference */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                            {session.reference}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => copyToClipboard(session.reference, session.id)}
                          >
                            {copied === session.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <Badge variant={hasProof ? 'default' : 'outline'} className="text-xs">
                          {hasProof ? (
                            <><FileImage className="h-3 w-3 mr-1" /> {t.proofReceived}</>
                          ) : (
                            <><Clock className="h-3 w-3 mr-1" /> {t.awaitingProof}</>
                          )}
                        </Badge>
                      </div>

                      {/* Customer */}
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {session.order?.profiles?.full_name || session.order?.profiles?.email || 'Unknown'}
                        </span>
                      </div>

                      {/* Amount */}
                      <div className="flex items-center gap-2 text-sm">
                        <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">
                          ${session.order?.total_usd?.toFixed(2) || '0.00'} USD
                        </span>
                        {session.order?.total_cdf && (
                          <span className="text-muted-foreground">
                            ({session.order.total_cdf.toLocaleString()} CDF)
                          </span>
                        )}
                      </div>

                      {/* Time */}
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}
                      </p>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        {pendingProof && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => openProof(pendingProof)}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            {t.viewProof}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="text-xs"
                          onClick={() => setConfirmDialog({ 
                            open: true, 
                            session, 
                            action: 'approve' 
                          })}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t.confirmPayment}
                        </Button>
                        {pendingProof && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="text-xs"
                            onClick={() => setConfirmDialog({ 
                              open: true, 
                              session, 
                              action: 'reject' 
                            })}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            {t.rejectPayment}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => {
        if (!open) {
          setConfirmDialog({ open: false, session: null, action: 'approve' });
          setAdminNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.action === 'approve' ? t.confirmTitle : t.rejectTitle}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.action === 'approve' ? t.confirmDesc : t.rejectDesc}
            </DialogDescription>
          </DialogHeader>

          {confirmDialog.session && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.reference}:</span>
                  <code className="font-mono">{confirmDialog.session.reference}</code>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.amount}:</span>
                  <span className="font-medium">
                    ${confirmDialog.session.order?.total_usd?.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.customer}:</span>
                  <span>
                    {confirmDialog.session.order?.profiles?.full_name || 
                     confirmDialog.session.order?.profiles?.email || 'Unknown'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">{t.notes}</Label>
                <Textarea
                  id="notes"
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder={confirmDialog.action === 'approve' 
                    ? 'Optional notes...' 
                    : 'Reason for rejection...'}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDialog({ open: false, session: null, action: 'approve' });
                setAdminNotes('');
              }}
              disabled={processing}
            >
              {t.cancel}
            </Button>
            <Button
              variant={confirmDialog.action === 'approve' ? 'default' : 'destructive'}
              onClick={handleAction}
              disabled={processing || (confirmDialog.action === 'reject' && !adminNotes.trim())}
            >
              {processing ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : confirmDialog.action === 'approve' ? (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              {confirmDialog.action === 'approve' ? t.confirm : t.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
