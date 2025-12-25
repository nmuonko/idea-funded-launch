import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  MessageCircle,
  Send,
  Loader2,
  User,
  Bot,
  Headphones,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Message {
  id: string;
  sender_type: 'user' | 'bot' | 'agent';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  user_id: string;
  status: 'bot' | 'waiting_agent' | 'assigned' | 'closed';
  language: string;
  assigned_agent_id: string | null;
  created_at: string;
  last_message_at: string;
  customer_name?: string;
  customer_email?: string;
}

export default function SupportInbox() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversations
  const loadConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('support_conversations')
        .select('*')
        .in('status', ['waiting_agent', 'assigned'])
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Enrich with customer info
      const enriched = await Promise.all(
        (data || []).map(async (conv) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('user_id', conv.user_id)
            .single();

          return {
            ...conv,
            status: conv.status as Conversation['status'],
            customer_name: profile?.full_name || 'Unknown',
            customer_email: profile?.email || '',
          } as Conversation;
        })
      );

      setConversations(enriched);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();

    // Subscribe to new conversations
    const channel = supabase
      .channel('support_conversations_admin')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_conversations',
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConv) return;

    const loadMessages = async () => {
      const { data } = await supabase
        .from('support_messages')
        .select('*')
        .eq('conversation_id', selectedConv.id)
        .order('created_at', { ascending: true });

      setMessages((data || []) as Message[]);
    };

    loadMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`support_messages_admin_${selectedConv.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `conversation_id=eq.${selectedConv.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConv?.id]);

  const sendMessage = async () => {
    if (!selectedConv || !inputValue.trim() || !user) return;

    setSending(true);
    try {
      // Assign conversation if not already
      if (selectedConv.status === 'waiting_agent') {
        await supabase
          .from('support_conversations')
          .update({
            status: 'assigned',
            assigned_agent_id: user.id,
          })
          .eq('id', selectedConv.id);

        setSelectedConv({ ...selectedConv, status: 'assigned', assigned_agent_id: user.id });
      }

      // Insert agent message
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'agent',
        content: inputValue.trim(),
      });

      // Update last_message_at
      await supabase
        .from('support_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', selectedConv.id);

      setInputValue('');
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

  const closeConversation = async () => {
    if (!selectedConv) return;

    try {
      await supabase
        .from('support_conversations')
        .update({ status: 'closed' })
        .eq('id', selectedConv.id);

      setSelectedConv(null);
      loadConversations();
      toast({ title: 'Conversation closed' });
    } catch (error) {
      console.error('Error closing conversation:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'waiting_agent':
        return <Badge variant="destructive" className="animate-pulse">Waiting</Badge>;
      case 'assigned':
        return <Badge variant="default" className="bg-green-600">Assigned</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="flex h-[calc(100vh-120px)]">
        {/* Conversations List */}
        <div className="w-80 border-r">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Support Inbox
              </h2>
              <Button variant="ghost" size="icon" onClick={loadConversations}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="h-[calc(100%-65px)]">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No pending conversations</p>
              </div>
            ) : (
              <div className="divide-y">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    className={cn(
                      'w-full p-4 text-left hover:bg-muted/50 transition-colors',
                      selectedConv?.id === conv.id && 'bg-muted'
                    )}
                    onClick={() => setSelectedConv(conv)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium truncate">{conv.customer_name}</span>
                      {getStatusBadge(conv.status)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(conv.last_message_at), 'HH:mm')}
                      <Badge variant="outline" className="text-xs">
                        {conv.language.toUpperCase()}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {selectedConv ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{selectedConv.customer_name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedConv.customer_email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedConv.status)}
                  <Button variant="outline" size="sm" onClick={closeConversation}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Close
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-2',
                        msg.sender_type === 'agent' ? 'flex-row-reverse' : 'flex-row'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          msg.sender_type === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : msg.sender_type === 'agent'
                            ? 'bg-green-600 text-white'
                            : 'bg-muted'
                        )}
                      >
                        {msg.sender_type === 'user' ? (
                          <User className="h-4 w-4" />
                        ) : msg.sender_type === 'agent' ? (
                          <Headphones className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div
                        className={cn(
                          'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                          msg.sender_type === 'agent'
                            ? 'bg-green-600 text-white'
                            : msg.sender_type === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        )}
                      >
                        {msg.content}
                        <div className="text-xs opacity-70 mt-1">
                          {format(new Date(msg.created_at), 'HH:mm')}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type your reply..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    disabled={sending}
                  />
                  <Button onClick={sendMessage} disabled={sending || !inputValue.trim()}>
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a conversation to respond</p>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
