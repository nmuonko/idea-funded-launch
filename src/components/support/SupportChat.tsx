import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  MessageCircle, 
  Send, 
  Loader2, 
  ChevronDown, 
  ChevronUp,
  User,
  Bot,
  Headphones,
  Truck,
  CreditCard,
  Package,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  sender_type: 'user' | 'bot' | 'agent';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  status: 'bot' | 'waiting_agent' | 'assigned' | 'closed';
  language: string;
}

const quickActions = [
  { key: 'delivery', icon: Truck, label: { fr: 'Livraison', en: 'Delivery', sw: 'Uwasilishaji', ln: 'Kokaba' } },
  { key: 'payment', icon: CreditCard, label: { fr: 'Paiement', en: 'Payment', sw: 'Malipo', ln: 'Kofuta' } },
  { key: 'orders', icon: Package, label: { fr: 'Commandes', en: 'Orders', sw: 'Maagizo', ln: 'Mitindo' } },
  { key: 'refund', icon: RefreshCw, label: { fr: 'Remboursement', en: 'Refund', sw: 'Marejesho', ln: 'Kozongisa' } },
];

const translations = {
  fr: {
    title: 'Assistance 24/7',
    subtitle: 'Posez votre question, réponse instantanée',
    openChat: 'Ouvrir le chat',
    closeChat: 'Fermer',
    placeholder: 'Écrivez votre message...',
    talkToAgent: 'Parler à un agent',
    waitingAgent: 'En attente d\'un agent...',
    agentConnected: 'Un agent vous répond',
    welcome: 'Bonjour! Je suis votre assistant virtuel. Comment puis-je vous aider aujourd\'hui?',
    escalated: 'Je vous mets en relation avec un agent. Patientez un instant...',
    loginRequired: 'Connectez-vous pour accéder au chat',
  },
  en: {
    title: '24/7 Support',
    subtitle: 'Ask your question, get instant answers',
    openChat: 'Open chat',
    closeChat: 'Close',
    placeholder: 'Type your message...',
    talkToAgent: 'Talk to an agent',
    waitingAgent: 'Waiting for an agent...',
    agentConnected: 'An agent is responding',
    welcome: 'Hello! I\'m your virtual assistant. How can I help you today?',
    escalated: 'I\'m connecting you with an agent. Please wait...',
    loginRequired: 'Log in to access chat',
  },
  sw: {
    title: 'Msaada 24/7',
    subtitle: 'Uliza swali lako, pata jibu mara moja',
    openChat: 'Fungua gumzo',
    closeChat: 'Funga',
    placeholder: 'Andika ujumbe wako...',
    talkToAgent: 'Ongea na wakala',
    waitingAgent: 'Kusubiri wakala...',
    agentConnected: 'Wakala anajibu',
    welcome: 'Habari! Mimi ni msaidizi wako wa mtandaoni. Ninawezaje kukusaidia leo?',
    escalated: 'Ninakuunganisha na wakala. Tafadhali subiri...',
    loginRequired: 'Ingia ili kufikia gumzo',
  },
  ln: {
    title: 'Lisungi 24/7',
    subtitle: 'Tuna motuna, yanola mbala moko',
    openChat: 'Fungola masolo',
    closeChat: 'Kanga',
    placeholder: 'Koma message na yo...',
    talkToAgent: 'Solola na agent',
    waitingAgent: 'Kozela agent...',
    agentConnected: 'Agent azali koyanola',
    welcome: 'Mbote! Nazali mosungi na yo ya internet. Nakoki kosalisa yo ndenge nini lelo?',
    escalated: 'Nazali kokangisa yo na agent. Zela mwa moke...',
    loginRequired: 'Kota po ozwa masolo',
  },
};

export function SupportChat() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const t = translations[language as keyof typeof translations] || translations.fr;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load or create conversation
  useEffect(() => {
    if (!user || !isOpen) return;

    const loadConversation = async () => {
      setLoading(true);
      try {
        // Find existing active conversation
        const { data: existing, error: fetchError } = await supabase
          .from('support_conversations')
          .select('*')
          .eq('user_id', user.id)
          .neq('status', 'closed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existing) {
          setConversation(existing as Conversation);
          // Load messages
          const { data: msgs } = await supabase
            .from('support_messages')
            .select('*')
            .eq('conversation_id', existing.id)
            .order('created_at', { ascending: true });
          
          setMessages((msgs || []) as Message[]);
        } else {
          // Create new conversation
          const { data: newConv, error: createError } = await supabase
            .from('support_conversations')
            .insert({
              user_id: user.id,
              language: language,
              status: 'bot',
            })
            .select()
            .single();

          if (createError) throw createError;
          
          setConversation(newConv as Conversation);
          
          // Add welcome message
          const { data: welcomeMsg } = await supabase
            .from('support_messages')
            .insert({
              conversation_id: newConv.id,
              sender_type: 'bot',
              content: t.welcome,
            })
            .select()
            .single();

          if (welcomeMsg) {
            setMessages([welcomeMsg as Message]);
          }
        }
      } catch (error) {
        console.error('Error loading conversation:', error);
        toast({
          title: 'Error',
          description: 'Failed to load chat',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadConversation();
  }, [user, isOpen, language, t.welcome, toast]);

  // Subscribe to realtime messages
  useEffect(() => {
    if (!conversation?.id) return;

    const channel = supabase
      .channel(`support_messages_${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some(m => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  const sendMessage = async (content: string) => {
    if (!conversation || !content.trim()) return;

    setSending(true);
    try {
      // Insert user message
      const { error: msgError } = await supabase
        .from('support_messages')
        .insert({
          conversation_id: conversation.id,
          sender_type: 'user',
          content: content.trim(),
        });

      if (msgError) throw msgError;

      setInputValue('');

      // Call bot edge function
      const { data, error } = await supabase.functions.invoke('support-chat-bot', {
        body: {
          conversation_id: conversation.id,
          message: content.trim(),
          language: language,
        },
      });

      if (error) {
        console.error('Bot error:', error);
      }

      // Update conversation status if escalated
      if (data?.escalated) {
        setConversation(prev => prev ? { ...prev, status: 'waiting_agent' } : null);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleQuickAction = (key: string) => {
    const prompts: Record<string, Record<string, string>> = {
      delivery: {
        fr: 'J\'ai une question sur la livraison de ma commande',
        en: 'I have a question about my order delivery',
        sw: 'Nina swali kuhusu uwasilishaji wa agizo langu',
        ln: 'Nazali na motuna mpo na kokaba commande na ngai',
      },
      payment: {
        fr: 'J\'ai un problème avec mon paiement',
        en: 'I have a problem with my payment',
        sw: 'Nina tatizo na malipo yangu',
        ln: 'Nazali na likambo na kofuta na ngai',
      },
      orders: {
        fr: 'Je voudrais vérifier le statut de ma commande',
        en: 'I would like to check my order status',
        sw: 'Ningependa kuangalia hali ya agizo langu',
        ln: 'Nalingi kotala état ya commande na ngai',
      },
      refund: {
        fr: 'Je voudrais demander un remboursement',
        en: 'I would like to request a refund',
        sw: 'Ningependa kuomba marejesho',
        ln: 'Nalingi kosɛnga kozongisa mbongo',
      },
    };
    
    const prompt = prompts[key]?.[language] || prompts[key]?.fr;
    if (prompt) {
      sendMessage(prompt);
    }
  };

  const escalateToAgent = async () => {
    if (!conversation) return;

    setSending(true);
    try {
      // Update conversation status
      await supabase
        .from('support_conversations')
        .update({ status: 'waiting_agent' })
        .eq('id', conversation.id);

      // Add escalation message
      await supabase
        .from('support_messages')
        .insert({
          conversation_id: conversation.id,
          sender_type: 'bot',
          content: t.escalated,
        });

      setConversation(prev => prev ? { ...prev, status: 'waiting_agent' } : null);

      // Trigger agent notification
      await supabase.functions.invoke('notify-support-agent', {
        body: { conversation_id: conversation.id },
      });
    } catch (error) {
      console.error('Error escalating:', error);
    } finally {
      setSending(false);
    }
  };

  const getStatusBadge = () => {
    if (!conversation) return null;
    
    switch (conversation.status) {
      case 'waiting_agent':
        return <Badge variant="secondary" className="animate-pulse">{t.waitingAgent}</Badge>;
      case 'assigned':
        return <Badge variant="default" className="bg-green-600">{t.agentConnected}</Badge>;
      default:
        return null;
    }
  };

  if (!user) {
    return (
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="h-5 w-5 text-primary" />
            {t.title}
          </CardTitle>
          <CardDescription>{t.loginRequired}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="h-5 w-5 text-primary" />
              {t.title}
            </CardTitle>
            <CardDescription>{t.subtitle}</CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        {!isOpen ? (
          <Button 
            onClick={() => setIsOpen(true)} 
            className="w-full"
            variant="outline"
          >
            <MessageCircle className="mr-2 h-4 w-4" />
            {t.openChat}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <div className="space-y-4">
            {/* Chat Messages */}
            <ScrollArea className="h-[300px] rounded-md border p-4">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-2',
                        msg.sender_type === 'user' ? 'flex-row-reverse' : 'flex-row'
                      )}
                    >
                      <div className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        msg.sender_type === 'user' 
                          ? 'bg-primary text-primary-foreground'
                          : msg.sender_type === 'agent'
                          ? 'bg-green-600 text-white'
                          : 'bg-muted'
                      )}>
                        {msg.sender_type === 'user' ? (
                          <User className="h-4 w-4" />
                        ) : msg.sender_type === 'agent' ? (
                          <Headphones className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div className={cn(
                        'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                        msg.sender_type === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <Button
                  key={action.key}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickAction(action.key)}
                  disabled={sending}
                >
                  <action.icon className="mr-1 h-3 w-3" />
                  {action.label[language as keyof typeof action.label] || action.label.fr}
                </Button>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                placeholder={t.placeholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(inputValue)}
                disabled={sending}
              />
              <Button 
                onClick={() => sendMessage(inputValue)} 
                disabled={sending || !inputValue.trim()}
                size="icon"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Agent Button & Close */}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={escalateToAgent}
                disabled={sending || conversation?.status === 'waiting_agent' || conversation?.status === 'assigned'}
                className="flex-1"
              >
                <Headphones className="mr-2 h-4 w-4" />
                {t.talkToAgent}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                {t.closeChat}
                <ChevronUp className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
