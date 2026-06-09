import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageCircle, User, Bot, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Renders message content with markdown links [text](url) as inline buttons
function renderAssistantContent(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${i}`}>{text.slice(last, m.index)}</span>);
    const label = m[1];
    const url = m[2];
    parts.push(
      <a key={`l${i}`} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 my-1 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium no-underline">
        <ExternalLink className="w-3 h-3" />
        {label.replace(/^[«»\s]+|[«»\s]+$/g, '')}
      </a>
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) parts.push(<span key={`t${i}`}>{text.slice(last)}</span>);
  return parts.length > 0 ? parts : text;
}
import { cn } from '@/lib/utils';

interface Conversation {
  id: string;
  user_id: string | null;
  session_id: string;
  product_context: any;
  status: string;
  escalated: boolean;
  escalation_reason: string | null;
  language: string;
  last_message_at: string;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  needs_escalation: boolean | null;
  created_at: string;
}

export default function ChatbotConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('chatbot_conversations')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(200);
      setConversations((data || []) as Conversation[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingMsgs(true);
      const { data } = await supabase
        .from('chatbot_messages')
        .select('*')
        .eq('conversation_id', selected.id)
        .order('created_at', { ascending: true });
      setMessages((data || []) as Message[]);
      setLoadingMsgs(false);
    })();
  }, [selected?.id]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="w-6 h-6" /> Sophie — Conversations Chatbot
        </h1>
        <p className="text-sm text-muted-foreground">Historique de toutes les conversations entre les clients et Sophie.</p>
      </div>

      <div className="grid md:grid-cols-[360px,1fr] gap-4 h-[calc(100vh-180px)]">
        <Card className="overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b text-xs font-semibold text-muted-foreground">
            {loading ? 'Chargement…' : `${conversations.length} conversations`}
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Aucune conversation</div>
            ) : (
              <div className="divide-y">
                {conversations.map(c => {
                  const productTitle = c.product_context?.title;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={cn(
                        'w-full text-left p-3 hover:bg-muted/50 transition',
                        selected?.id === c.id && 'bg-muted'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono text-muted-foreground truncate">
                          {c.user_id ? c.user_id.slice(0, 8) : `guest·${c.session_id.slice(0, 6)}`}
                        </div>
                        {c.escalated && <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-0.5" />escaladé</Badge>}
                      </div>
                      {productTitle && <div className="text-xs mt-1 line-clamp-1 font-medium">{productTitle}</div>}
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {new Date(c.last_message_at).toLocaleString('fr-FR')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        <Card className="overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Sélectionnez une conversation
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b">
                <div className="font-semibold text-sm">
                  {selected.user_id ? `Utilisateur ${selected.user_id.slice(0, 8)}` : `Invité ${selected.session_id.slice(0, 8)}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  Langue: {selected.language} · {selected.escalated ? `Escaladé: ${selected.escalation_reason || '—'}` : 'Bot'}
                </div>
                {selected.product_context?.title && (
                  <div className="text-xs mt-1 text-muted-foreground">Produit: {selected.product_context.title}</div>
                )}
              </div>
              <ScrollArea className="flex-1 p-4">
                {loadingMsgs ? (
                  <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                ) : (
                  <div className="space-y-3">
                    {messages.map(m => (
                      <div key={m.id} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                        {m.role !== 'user' && (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Bot className="w-3.5 h-3.5 text-primary" />
                          </div>
                        )}
                        <div className={cn(
                          'max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                          m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        )}>
                          {m.role === 'assistant' ? renderAssistantContent(m.content) : m.content}
                          <div className="text-[10px] mt-1 opacity-60">{new Date(m.created_at).toLocaleString('fr-FR')}</div>
                        </div>
                        {m.role === 'user' && (
                          <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
