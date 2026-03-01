import { useState, useEffect, useRef, useCallback } from 'react';
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
  Search,
  ChevronLeft,
  Circle,
  UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import SupportContactSettings from './SupportContactSettings';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  last_message_preview?: string;
  has_unread?: boolean;
}

interface RoutingAgent {
  id: string;
  admin_user_id: string;
  admin_name: string | null;
  admin_email: string | null;
  is_available: boolean;
  chats_assigned_count: number;
  priority_order: number;
}

type TabValue = 'active' | 'closed';

// Helper: get the next available agent from routing config (round-robin by lowest count)
async function getNextAvailableAgent(): Promise<RoutingAgent | null> {
  const { data, error } = await supabase
    .from('chat_routing_config')
    .select('*')
    .eq('is_available', true)
    .order('chats_assigned_count', { ascending: true })
    .order('priority_order', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as RoutingAgent;
}

// Helper: auto-assign a conversation to an agent
async function autoAssignConversation(conversationId: string): Promise<{ agentName: string } | null> {
  const agent = await getNextAvailableAgent();
  if (!agent) return null;

  // Assign the conversation
  const { error: updateError } = await supabase
    .from('support_conversations')
    .update({
      status: 'assigned',
      assigned_agent_id: agent.admin_user_id,
    })
    .eq('id', conversationId)
    .eq('status', 'waiting_agent'); // Only assign if still waiting

  if (updateError) {
    console.error('Auto-assign failed:', updateError);
    return null;
  }

  // Increment agent's chat count
  await supabase
    .from('chat_routing_config')
    .update({
      chats_assigned_count: agent.chats_assigned_count + 1,
      last_assigned_at: new Date().toISOString(),
    })
    .eq('id', agent.id);

  // Send system message
  const agentLabel = agent.admin_name || agent.admin_email || 'an agent';
  await supabase.from('support_messages').insert({
    conversation_id: conversationId,
    sender_type: 'system',
    content: `Conversation automatically assigned to ${agentLabel}`,
    meta: { agent_name: agentLabel },
  });

  return { agentName: agentLabel };
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
  const [claiming, setClaiming] = useState(false);
  const [currentAgentName, setCurrentAgentName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabValue>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [routingAgents, setRoutingAgents] = useState<RoutingAgent[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check if current user is super admin + get agent name
  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!user) return;
      
      const [profileRes, roleRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, email')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('user_roles')
          .select('admin_role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single(),
      ]);

      setCurrentAgentName(profileRes.data?.full_name || profileRes.data?.email || 'Agent');
      setIsSuperAdmin(roleRes.data?.admin_role === 'super_admin');
    };
    fetchUserInfo();
  }, [user]);

  // Load routing agents for reassign dropdown
  useEffect(() => {
    const loadRoutingAgents = async () => {
      const { data } = await supabase
        .from('chat_routing_config')
        .select('*')
        .order('priority_order', { ascending: true });
      setRoutingAgents((data || []) as RoutingAgent[]);
    };
    loadRoutingAgents();
  }, []);

  // Load conversations with batch profile loading + agent-based filtering
  const loadConversations = useCallback(async (tab: TabValue = activeTab) => {
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

      let convs = data || [];

      // Agent-based filtering: non-super-admins only see their own + unclaimed
      if (!isSuperAdmin && user) {
        convs = convs.filter(c => 
          c.assigned_agent_id === user.id || c.status === 'waiting_agent'
        );
      }

      if (convs.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      // Batch: collect all unique user IDs (customers + agents)
      const customerIds = [...new Set(convs.map(c => c.user_id))];
      const agentIds = [...new Set(convs.map(c => c.assigned_agent_id).filter(Boolean))] as string[];
      const allUserIds = [...new Set([...customerIds, ...agentIds])];

      // Single batch query for all profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', allUserIds);

      const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
      (profiles || []).forEach(p => profileMap.set(p.user_id, p));

      // Batch: get last message for each conversation (preview + unread detection)
      const convIds = convs.map(c => c.id);
      const { data: lastMessages } = await supabase
        .from('support_messages')
        .select('conversation_id, content, sender_type, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false });

      // Build last-message map (first occurrence per conversation_id = latest)
      const lastMsgMap = new Map<string, { content: string; sender_type: string }>();
      (lastMessages || []).forEach(m => {
        if (!lastMsgMap.has(m.conversation_id)) {
          lastMsgMap.set(m.conversation_id, { content: m.content, sender_type: m.sender_type });
        }
      });

      const enriched: Conversation[] = convs.map(conv => {
        const customerProfile = profileMap.get(conv.user_id);
        const agentProfile = conv.assigned_agent_id ? profileMap.get(conv.assigned_agent_id) : null;
        const lastMsg = lastMsgMap.get(conv.id);
        
        return {
          ...conv,
          status: conv.status as Conversation['status'],
          customer_name: customerProfile?.full_name || 'Unknown',
          customer_email: customerProfile?.email || '',
          agent_name: agentProfile ? (agentProfile.full_name || agentProfile.email || 'Agent') : null,
          last_message_preview: lastMsg?.content?.substring(0, 60) || '',
          has_unread: lastMsg?.sender_type === 'user' && conv.status !== 'closed',
        } as Conversation;
      });

      // Auto-assign any waiting_agent conversations
      if (tab === 'active') {
        for (const conv of enriched) {
          if (conv.status === 'waiting_agent') {
            const result = await autoAssignConversation(conv.id);
            if (result) {
              conv.status = 'assigned';
              conv.agent_name = result.agentName;
            }
          }
        }
      }

      setConversations(enriched);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, isSuperAdmin, user]);

  useEffect(() => {
    loadConversations(activeTab);

    const channel = supabase
      .channel('support_conversations_admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_conversations' },
        () => { loadConversations(activeTab); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeTab, loadConversations]);

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

    const channel = supabase
      .channel(`support_messages_admin_${selectedConv.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedConv.id}` },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedConv?.id]);

  const claimConversation = async () => {
    if (!selectedConv || !user) return;
    setClaiming(true);
    try {
      const { error } = await supabase
        .from('support_conversations')
        .update({ status: 'assigned', assigned_agent_id: user.id })
        .eq('id', selectedConv.id);
      if (error) throw error;
      setSelectedConv({ ...selectedConv, status: 'assigned', assigned_agent_id: user.id, agent_name: currentAgentName });
      toast({ title: 'Conversation claimed' });
      loadConversations();
    } catch (error) {
      console.error('Error claiming conversation:', error);
      toast({ title: 'Error', description: 'Failed to claim conversation', variant: 'destructive' });
    } finally {
      setClaiming(false);
    }
  };

  const reassignConversation = async (agentId: string) => {
    if (!selectedConv) return;
    setReassigning(true);
    try {
      const agent = routingAgents.find(a => a.admin_user_id === agentId);
      const agentLabel = agent?.admin_name || agent?.admin_email || 'Agent';

      const { error } = await supabase
        .from('support_conversations')
        .update({ status: 'assigned', assigned_agent_id: agentId })
        .eq('id', selectedConv.id);
      if (error) throw error;

      // Send system message about reassignment
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'system',
        content: `Conversation reassigned to ${agentLabel}`,
        meta: { agent_name: currentAgentName },
      });

      setSelectedConv({ ...selectedConv, status: 'assigned', assigned_agent_id: agentId, agent_name: agentLabel });
      toast({ title: `Reassigned to ${agentLabel}` });
      loadConversations();
    } catch (error) {
      console.error('Error reassigning:', error);
      toast({ title: 'Error', description: 'Failed to reassign', variant: 'destructive' });
    } finally {
      setReassigning(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedConv || !inputValue.trim() || !user) return;
    if (selectedConv.status === 'waiting_agent') {
      toast({ title: 'Claim first', description: 'Please claim this conversation before replying', variant: 'destructive' });
      return;
    }
    if (selectedConv.assigned_agent_id !== user.id && !isSuperAdmin) {
      toast({ title: 'Not assigned', description: 'This conversation is assigned to another agent', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'agent',
        content: inputValue.trim(),
        meta: { agent_name: currentAgentName },
      });
      await supabase
        .from('support_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', selectedConv.id);
      setInputValue('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast({ title: 'Error', description: 'Failed to send message', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const closeConversation = async () => {
    if (!selectedConv) return;
    try {
      await supabase.from('support_messages').insert({
        conversation_id: selectedConv.id,
        sender_type: 'system',
        content: 'This conversation has been resolved. Send a new message if you need further help.',
        meta: { closed_by: currentAgentName },
      });
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
        return <Badge variant="destructive" className="animate-pulse text-xs">Unclaimed</Badge>;
      case 'assigned':
        return <Badge variant="default" className="bg-green-600 text-xs">{agentName || 'Assigned'}</Badge>;
      case 'closed':
        return <Badge variant="secondary" className="text-xs">Closed</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue);
    setSelectedConv(null);
  };

  const handleSelectConv = (conv: Conversation) => {
    setSelectedConv(conv);
    if (window.innerWidth < 768) {
      setShowSidebar(false);
    }
  };

  // Filter conversations by search
  const filteredConversations = searchQuery.trim()
    ? conversations.filter(c =>
        (c.customer_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.customer_email || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const isClosed = selectedConv?.status === 'closed';
  const isMyConversation = selectedConv?.assigned_agent_id === user?.id;
  const canClaim = selectedConv?.status === 'waiting_agent';
  const canReply = (selectedConv?.status === 'assigned' && isMyConversation) || (selectedConv?.status === 'assigned' && isSuperAdmin);
  const canClose = isMyConversation || isSuperAdmin;

  const waitingCount = conversations.filter(c => c.status === 'waiting_agent').length;

  return (
    <div className="flex h-[calc(100vh-120px)]">
      {/* Conversations Sidebar */}
      <div className={cn(
        'border-r flex flex-col bg-background transition-all duration-200',
        showSidebar ? 'w-full md:w-96' : 'w-0 overflow-hidden md:w-96 md:overflow-visible'
      )}>
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Support Inbox
              {waitingCount > 0 && (
                <Badge variant="destructive" className="text-xs">{waitingCount}</Badge>
              )}
            </h2>
            <Button variant="ghost" size="icon" onClick={() => loadConversations()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
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
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {searchQuery ? (
                <>
                  <Search className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No results for "{searchQuery}"</p>
                </>
              ) : activeTab === 'active' ? (
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
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  className={cn(
                    'w-full p-3 text-left hover:bg-muted/50 transition-colors',
                    selectedConv?.id === conv.id && 'bg-muted'
                  )}
                  onClick={() => handleSelectConv(conv)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {conv.has_unread && (
                        <Circle className="h-2 w-2 fill-primary text-primary shrink-0" />
                      )}
                      <span className={cn(
                        'truncate text-sm',
                        conv.has_unread ? 'font-semibold' : 'font-medium'
                      )}>
                        {conv.customer_name}
                      </span>
                    </div>
                    {getStatusBadge(conv.status, conv.agent_name)}
                  </div>
                  {conv.last_message_preview && (
                    <p className={cn(
                      'text-xs truncate mb-1',
                      conv.has_unread ? 'text-foreground/80' : 'text-muted-foreground'
                    )}>
                      {conv.last_message_preview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {format(new Date(conv.last_message_at), 'MMM d, HH:mm')}
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
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
      <div className={cn(
        'flex-1 flex flex-col min-w-0',
        !showSidebar ? 'flex' : 'hidden md:flex'
      )}>
        {selectedConv ? (
          <>
            {/* Chat Header */}
            <div className="p-3 md:p-4 border-b flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="md:hidden shrink-0"
                  onClick={() => setShowSidebar(true)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{selectedConv.customer_name}</h3>
                  <p className="text-sm text-muted-foreground truncate">{selectedConv.customer_email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getStatusBadge(selectedConv.status, selectedConv.agent_name)}
                
                {/* Reassign dropdown - super admin only */}
                {isSuperAdmin && selectedConv.status !== 'closed' && routingAgents.length > 0 && (
                  <Select
                    value=""
                    onValueChange={(agentId) => reassignConversation(agentId)}
                    disabled={reassigning}
                  >
                    <SelectTrigger className="w-auto h-8 text-xs gap-1">
                      {reassigning ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <UserCog className="h-3 w-3" />
                      )}
                      <span className="hidden sm:inline">Reassign</span>
                    </SelectTrigger>
                    <SelectContent>
                      {routingAgents.map(agent => (
                        <SelectItem 
                          key={agent.admin_user_id} 
                          value={agent.admin_user_id}
                          disabled={agent.admin_user_id === selectedConv.assigned_agent_id}
                        >
                          <div className="flex items-center gap-2">
                            <span>{agent.admin_name || agent.admin_email || 'Agent'}</span>
                            {!agent.is_available && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">Offline</Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                              {agent.chats_assigned_count} chats
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {canClaim && (
                  <Button variant="default" size="sm" onClick={claimConversation} disabled={claiming}>
                    {claiming ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Hand className="mr-1 h-4 w-4" />}
                    Claim
                  </Button>
                )}
                {canClose && !isClosed && (
                  <Button variant="outline" size="sm" onClick={closeConversation}>
                    <XCircle className="mr-1 h-4 w-4" />
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
            <div className="p-3 md:p-4 border-t">
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
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
