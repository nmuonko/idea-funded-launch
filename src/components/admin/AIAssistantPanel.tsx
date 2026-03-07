import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, FileText, Shield, Mail, Tag, Loader2, Copy, Send } from 'lucide-react';

interface AIAssistantPanelProps {
  order: any;
}

export function AIAssistantPanel({ order }: AIAssistantPanelProps) {
  const [loading, setLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [result, setResult] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [activeAction, setActiveAction] = useState<string>('');
  const { toast } = useToast();

  const runAIAction = async (action: string) => {
    try {
      setLoading(true);
      setActiveAction(action);
      setResult('');

      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: {
          action: 'ai_assistant',
          orderId: order.id,
          aiAction: action,
          customPrompt: action === 'DRAFT_EMAIL' ? customPrompt : undefined
        }
      });

      if (error) throw error;

      setResult(data.result);
      
      toast({
        title: 'AI Assistant',
        description: `${action.replace('_', ' ')} completed successfully`,
      });
    } catch (error: any) {
      toast({
        title: 'AI Assistant failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    toast({
      title: 'Copied',
      description: 'Result copied to clipboard',
    });
  };

  const sendDraftEmail = async () => {
    if (!order.profiles?.email) {
      toast({
        title: 'No email address',
        description: 'Customer email not available',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSendingEmail(true);

      // Parse subject and body from AI result
      const lines = result.split('\n');
      let subject = 'Message from AfriShop';
      let body = result;

      // Try to extract subject from "Subject:" line
      const subjectLine = lines.find(line => line.toLowerCase().startsWith('subject:'));
      if (subjectLine) {
        subject = subjectLine.replace(/^subject:\s*/i, '').trim();
        body = lines.filter(line => !line.toLowerCase().startsWith('subject:')).join('\n').trim();
      }

      const { error } = await supabase.functions.invoke('email-service', {
        body: {
          type: 'customer_email',
          customerId: order.user_id,
          customerEmail: order.profiles.email,
          customerName: order.profiles.name || order.profiles.full_name || 'Customer',
          subject,
          body,
        }
      });

      if (error) throw error;

      toast({
        title: 'Email sent',
        description: `Email sent to ${order.profiles.email}`,
      });
    } catch (error: any) {
      toast({
        title: 'Failed to send email',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          AI Assistant
        </CardTitle>
        <CardDescription>
          Powered by Lovable AI - Summarize, detect fraud, draft emails, and more
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => runAIAction('SUMMARIZE')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading && activeAction === 'SUMMARIZE' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Summarize
              </>
            )}
          </Button>

          <Button
            onClick={() => runAIAction('FRAUD_CHECK')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading && activeAction === 'FRAUD_CHECK' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Fraud Check
              </>
            )}
          </Button>

          <Button
            onClick={() => runAIAction('GENERATE_LABEL')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading && activeAction === 'GENERATE_LABEL' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Tag className="h-4 w-4 mr-2" />
                Shipping Label
              </>
            )}
          </Button>

          <Button
            onClick={() => runAIAction('DRAFT_EMAIL')}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading && activeAction === 'DRAFT_EMAIL' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Draft Email
              </>
            )}
          </Button>
        </div>

        {/* Custom Prompt for Email */}
        {activeAction === 'DRAFT_EMAIL' && (
          <Textarea
            placeholder="Optional: Specify email topic (e.g., 'shipping delay', 'order confirmation')..."
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="min-h-[60px]"
          />
        )}

        {/* Result Display */}
        {result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-purple-600 border-purple-600">
                <Sparkles className="h-3 w-3 mr-1" />
                AI Generated
              </Badge>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={copyToClipboard}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
                {activeAction === 'DRAFT_EMAIL' && order.profiles?.email && (
                  <Button
                    size="sm"
                    onClick={sendDraftEmail}
                    disabled={sendingEmail}
                  >
                    {sendingEmail ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send to Customer
                  </Button>
                )}
              </div>
            </div>
            <div className="bg-muted p-4 rounded-lg border">
              <pre className="text-sm whitespace-pre-wrap font-sans">
                {result}
              </pre>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
            <span className="ml-2 text-sm text-muted-foreground">
              AI is thinking...
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
