import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Check, X, Clock, Zap, MessageSquare, ShoppingCart, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

interface AIAction {
  id: string;
  action_type: string;
  target_id: string;
  target_type: string;
  ai_decision: any;
  confidence_score: number;
  status: string;
  created_at: string;
  targetDetails?: any;
}

interface AIActionsSummary {
  pending_review: number;
  approved: number;
  rejected: number;
  auto_executed: number;
  by_type: Record<string, number>;
}

export function AIActionsPanel() {
  const { language } = useLanguage();
  const [actions, setActions] = useState<AIAction[]>([]);
  const [summary, setSummary] = useState<AIActionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<AIAction | null>(null);
  const [modifiedContent, setModifiedContent] = useState('');
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('pending_review');

  const fetchActions = async (status: string = 'pending_review') => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: { action: 'ai_actions_review' },
      });

      if (error) throw error;

      setActions(data.actions || []);
      setSummary(data.summary);
    } catch (error: any) {
      console.error('Error fetching AI actions:', error);
      toast.error(language === 'fr' ? 'Erreur de chargement' : 'Failed to load AI actions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActions(activeTab);
  }, [activeTab]);

  const handleAction = async (decision: 'approve' | 'reject') => {
    if (!selectedAction) return;

    setExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke('execute-ai-action', {
        body: {
          actionId: selectedAction.id,
          decision,
          modifiedContent: modifiedContent || undefined,
        },
      });

      if (error) throw error;

      toast.success(
        decision === 'approve'
          ? (language === 'fr' ? 'Action exécutée' : 'Action executed')
          : (language === 'fr' ? 'Action rejetée' : 'Action rejected')
      );

      setSelectedAction(null);
      setModifiedContent('');
      fetchActions(activeTab);
    } catch (error: any) {
      console.error('Error executing action:', error);
      toast.error(error.message || 'Failed to execute action');
    } finally {
      setExecuting(false);
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'ticket_response':
        return <MessageSquare className="h-4 w-4" />;
      case 'escalation':
        return <AlertTriangle className="h-4 w-4" />;
      case 'cart_recovery':
        return <ShoppingCart className="h-4 w-4" />;
      default:
        return <Bot className="h-4 w-4" />;
    }
  };

  const getActionLabel = (type: string) => {
    const labels: Record<string, { en: string; fr: string }> = {
      ticket_response: { en: 'Response Draft', fr: 'Brouillon de réponse' },
      escalation: { en: 'Escalation', fr: 'Escalade' },
      cart_recovery: { en: 'Cart Recovery', fr: 'Récupération panier' },
      recommendation: { en: 'Recommendation', fr: 'Recommandation' },
    };
    return labels[type]?.[language] || type;
  };

  const getConfidenceBadge = (score: number) => {
    if (score >= 0.85) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">High {Math.round(score * 100)}%</Badge>;
    } else if (score >= 0.6) {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Medium {Math.round(score * 100)}%</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Low {Math.round(score * 100)}%</Badge>;
  };

  const filteredActions = actions.filter((a) => {
    if (activeTab === 'all') return true;
    return a.status === activeTab;
  });

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">
            {language === 'fr' ? 'Actions IA' : 'AI Actions'}
          </CardTitle>
          {summary && summary.pending_review > 0 && (
            <Badge variant="destructive">{summary.pending_review}</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchActions(activeTab)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="pending_review" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {language === 'fr' ? 'En attente' : 'Pending'}
              {summary?.pending_review ? ` (${summary.pending_review})` : ''}
            </TabsTrigger>
            <TabsTrigger value="auto_executed" className="text-xs">
              <Zap className="h-3 w-3 mr-1" />
              {language === 'fr' ? 'Auto' : 'Auto'}
            </TabsTrigger>
            <TabsTrigger value="approved" className="text-xs">
              <Check className="h-3 w-3 mr-1" />
              {language === 'fr' ? 'Approuvé' : 'Approved'}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs">
              <X className="h-3 w-3 mr-1" />
              {language === 'fr' ? 'Rejeté' : 'Rejected'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <ScrollArea className="h-[400px]">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredActions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {language === 'fr' ? 'Aucune action' : 'No actions'}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredActions.map((action) => (
                    <div
                      key={action.id}
                      className="p-3 rounded-lg border border-border/50 bg-background/50 hover:bg-background/80 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedAction(action);
                        setModifiedContent(action.ai_decision?.suggestedResponse || '');
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {getActionIcon(action.action_type)}
                          <span className="font-medium text-sm">
                            {getActionLabel(action.action_type)}
                          </span>
                        </div>
                        {getConfidenceBadge(action.confidence_score)}
                      </div>

                      {action.targetDetails && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {action.target_type === 'support_ticket' && (
                            <p>
                              {language === 'fr' ? 'Ticket:' : 'Ticket:'} {action.targetDetails.subject}
                              <br />
                              {action.targetDetails.profiles?.full_name || action.targetDetails.profiles?.email}
                            </p>
                          )}
                          {action.target_type === 'order' && (
                            <p>
                              {language === 'fr' ? 'Commande:' : 'Order:'} ${action.targetDetails.total_usd?.toFixed(2)}
                              <br />
                              {action.targetDetails.profiles?.full_name || action.targetDetails.profiles?.email}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="mt-2 text-xs text-muted-foreground">
                        {new Date(action.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Action Detail Dialog */}
      <Dialog open={!!selectedAction} onOpenChange={() => setSelectedAction(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedAction && getActionIcon(selectedAction.action_type)}
              {selectedAction && getActionLabel(selectedAction.action_type)}
            </DialogTitle>
          </DialogHeader>

          {selectedAction && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Confiance:' : 'Confidence:'}
                </span>
                {getConfidenceBadge(selectedAction.confidence_score)}
              </div>

              {selectedAction.targetDetails && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <h4 className="font-medium text-sm mb-2">
                    {language === 'fr' ? 'Contexte' : 'Context'}
                  </h4>
                  {selectedAction.target_type === 'support_ticket' && (
                    <div className="text-sm space-y-1">
                      <p><strong>{language === 'fr' ? 'Sujet:' : 'Subject:'}</strong> {selectedAction.targetDetails.subject}</p>
                      <p><strong>{language === 'fr' ? 'Client:' : 'Customer:'}</strong> {selectedAction.targetDetails.profiles?.full_name}</p>
                      <p><strong>Email:</strong> {selectedAction.targetDetails.profiles?.email}</p>
                      <p><strong>{language === 'fr' ? 'Statut:' : 'Status:'}</strong> {selectedAction.targetDetails.status}</p>
                    </div>
                  )}
                  {selectedAction.target_type === 'order' && (
                    <div className="text-sm space-y-1">
                      <p><strong>{language === 'fr' ? 'Total:' : 'Total:'}</strong> ${selectedAction.targetDetails.total_usd?.toFixed(2)}</p>
                      <p><strong>{language === 'fr' ? 'Client:' : 'Customer:'}</strong> {selectedAction.targetDetails.profiles?.full_name}</p>
                      <p><strong>Email:</strong> {selectedAction.targetDetails.profiles?.email}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  {language === 'fr' ? 'Décision IA' : 'AI Decision'}
                </h4>
                <div className="text-sm space-y-1">
                  {selectedAction.ai_decision?.action && (
                    <p><strong>{language === 'fr' ? 'Action:' : 'Action:'}</strong> {selectedAction.ai_decision.action}</p>
                  )}
                  {selectedAction.ai_decision?.reason && (
                    <p><strong>{language === 'fr' ? 'Raison:' : 'Reason:'}</strong> {selectedAction.ai_decision.reason}</p>
                  )}
                  {selectedAction.ai_decision?.sentiment && (
                    <p><strong>Sentiment:</strong> {selectedAction.ai_decision.sentiment}</p>
                  )}
                </div>
              </div>

              {(selectedAction.action_type === 'ticket_response' || selectedAction.action_type === 'cart_recovery') && (
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {language === 'fr' ? 'Réponse (modifiable)' : 'Response (editable)'}
                  </label>
                  <Textarea
                    value={modifiedContent}
                    onChange={(e) => setModifiedContent(e.target.value)}
                    rows={6}
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            {selectedAction?.status === 'pending_review' && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => handleAction('reject')}
                  disabled={executing}
                >
                  <X className="h-4 w-4 mr-2" />
                  {language === 'fr' ? 'Rejeter' : 'Reject'}
                </Button>
                <Button
                  onClick={() => handleAction('approve')}
                  disabled={executing}
                >
                  <Check className="h-4 w-4 mr-2" />
                  {language === 'fr' ? 'Approuver & Exécuter' : 'Approve & Execute'}
                </Button>
              </>
            )}
            {selectedAction?.status !== 'pending_review' && (
              <Button variant="outline" onClick={() => setSelectedAction(null)}>
                {language === 'fr' ? 'Fermer' : 'Close'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
