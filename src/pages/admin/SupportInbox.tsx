import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Hand,
  Archive,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import SupportContactSettings from './SupportContactSettings';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface Message {
  id: string;
  sender_type: 'user' | 'bot' | 'agent' | 'system';
  content: string;
  created_at: string;
  meta?: { agent_name?: string };
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
  agent_name?: string;
}

type TabValue = 'active' | 'closed';

export default function SupportInbox() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [currentAgentName, setCurrentAgentName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabValue>('active');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Get current user's name
  useEffect(() => {
    const fetchAgentName = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', user.id)
        .single();
      setCurrentAgentName(data?.full_name || data?.email || 'Agent');
    };
    fetchAgentName();
  }, [user]);

  // Load conversations based on active tab
  const loadConversations = async (tab: TabValue = activeTab) => {
    try {
      setLoading(true);
      const statuses = tab === 'active' 
        ? ['waiting_agent', 'assigned'] 
        : ['closed'];
      
      const { data, error } = await supabase
        .from('support_conversations')
        .select('*')
        .in('status', statuses)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      // Enrich with customer and agent info
      const enriched = await Promise.all(
        (data || []).map(async (conv) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('user_id', conv.user_id)
            .single();

          let agentName = null;
          if (conv.assigned_agent_id) {
            const { data: agentProfile } = await supabase
              .from('profiles')
              .select('full_name, email')
              .eq('user_id', conv.assigned_agent_id)
              .single();
            agentName = agentProfile?.full_name || agentProfile?.email || 'Agent';
          }

          return {
            ...conv,
            status: conv.status as Conversation['status'],
            customer_name: profile?.full_name || 'Unknown',
            customer_email: profile?.email || '',
            agent_name: agentName,
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
    loadConversations(activeTab);

    // Subscribe to conversation changes
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
          loadConversations(activeTab);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

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

  const claimConversation = async () => {
    if (!selectedConv || !user) return;

    setClaiming(true);
    try {
      const { error } = await supabase
        .from('support_conversations')
        .update({
          status: 'assigned',
          assigned_agent_id: user.id,
        })
        .eq('id', selectedConv.id);

      if (error) throw error;

      setSelectedConv({ 
        ...selectedConv, 
        status: 'assigned', 
        assigned_agent_id: user.id,
        agent_name: currentAgentName 
      });
      
      toast({ title: 'Conversation claimed', description: `You are now handling this conversation` });
      loadConversations();
    } catch (error) {
      console.error('Error claiming conversation:', error);
      toast({
        title: 'Error',
        description: 'Failed to claim conversation',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedConv || !inputValue.trim() || !user) return;

    // Must claim first if not assigned
    if (selectedConv.status === 'waiting_agent') {
      toast({
        title: 'Claim first',
        description: 'Please claim this conversation before replying',
        variant: 'destructive',
      });
      return;
    }

    // Can only reply if you're the assigned agent
    if (selectedConv.assigned_agent_id !== user.id) {
      toast({
        title: 'Not assigned',
        description: 'This conversation is assigned to another agent',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      // Insert agent message with agent name in meta
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'agent',
        content: inputValue.trim(),
        meta: { agent_name: currentAgentName },
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
      // Insert system message before closing
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'system',
        content: 'This conversation has been resolved. Send a new message if you need further help.',
        meta: { closed_by: currentAgentName },
      });

      // Update conversation status
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

  const getStatusBadge = (status: string, agentName?: string | null) => {
    switch (status) {
      case 'waiting_agent':
        return <Badge variant="destructive" className="animate-pulse">Unclaimed</Badge>;
      case 'assigned':
        return (
          <Badge variant="default" className="bg-green-600">
            {agentName || 'Assigned'}
          </Badge>
        );
      case 'closed':
        return <Badge variant="secondary">Closed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue);
    setSelectedConv(null);
  };

  const isClosed = selectedConv?.status === 'closed';

  const isMyConversation = selectedConv?.assigned_agent_id === user?.id;
  const canClaim = selectedConv?.status === 'waiting_agent';
  const canReply = selectedConv?.status === 'assigned' && isMyConversation;

  return (
    <div className="flex h-[calc(100vh-120px)]">
      {/* Conversations List */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Support Inbox
            </h2>
            <Button variant="ghost" size="icon" onClick={() => loadConversations()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full">
              <TabsTrigger value="active" className="flex-1 gap-1">
                <Headphones className="h-3 w-3" />
                Active
              </TabsTrigger>
              <TabsTrigger value="closed" className="flex-1 gap-1">
                <Archive className="h-3 w-3" />
                Closed
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {activeTab === 'active' ? (
                <>
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No active conversations</p>
                </>
              ) : (
                <>
                  <Archive className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No closed conversations</p>
                </>
              )}
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
                    {getStatusBadge(conv.status, conv.agent_name)}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {format(new Date(conv.last_message_at), 'MMM d, HH:mm')}
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
                {getStatusBadge(selectedConv.status, selectedConv.agent_name)}
                
                {canClaim && (
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={claimConversation}
                    disabled={claiming}
                  >
                    {claiming ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Hand className="mr-2 h-4 w-4" />
                    )}
                    Claim
                  </Button>
                )}
                
                {isMyConversation && (
                  <Button variant="outline" size="sm" onClick={closeConversation}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Close
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {messages.map((msg) => {
                  const agentName = msg.meta?.agent_name;
                  
                  // System messages render differently
                  if (msg.sender_type === 'system') {
                    return (
                      <div key={msg.id} className="flex justify-center my-4">
                        <div className="flex items-center gap-2 bg-muted/50 text-muted-foreground px-4 py-2 rounded-full text-sm">
                          <Info className="h-4 w-4" />
                          {msg.content}
                        </div>
                      </div>
                    );
                  }
                  
                  return (
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
                        {msg.sender_type === 'agent' && agentName && (
                          <div className="text-xs font-medium opacity-80 mb-1">{agentName}</div>
                        )}
                        {msg.content}
                        <div className="text-xs opacity-70 mt-1">
                          {format(new Date(msg.created_at), 'HH:mm')}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t">
              {isClosed ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  This conversation is closed. It will reopen if the customer sends a new message.
                </p>
              ) : (
                <>
                  {!canReply && !canClaim && (
                    <p className="text-sm text-muted-foreground text-center mb-2">
                      This conversation is handled by {selectedConv.agent_name}
                    </p>
                  )}
                  {canClaim && (
                    <p className="text-sm text-muted-foreground text-center mb-2">
                      Claim this conversation to start replying
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder={canReply ? "Type your reply..." : "Claim to reply..."}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      disabled={sending || !canReply}
                    />
                    <Button onClick={sendMessage} disabled={sending || !inputValue.trim() || !canReply}>
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              )}
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
