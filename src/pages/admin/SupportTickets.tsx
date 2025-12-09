import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { MessageSquare, Clock, CheckCircle, AlertCircle, User, Calendar, AlertTriangle, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { ResetSectionDialog } from '@/components/admin/ResetSectionDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation, getStatusTranslation } from '@/lib/i18n/translations';

interface Ticket {
  id: string;
  user_id: string;
  order_id: string | null;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  escalated: boolean;
  escalated_at: string | null;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_admin: boolean;
  created_at: string;
}

export default function SupportTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Ticket['status']>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Ticket['priority']>('all');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { permissions } = useAdminPermissions();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    fetchTickets();
  }, [statusFilter, priorityFilter]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (priorityFilter !== 'all') {
        query = query.eq('priority', priorityFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTickets(data || []);
    } catch (error: any) {
      toast.error('Failed to fetch tickets');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (ticketId: string) => {
    try {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('id, message, is_admin, created_at, ticket_id, user_id')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error: any) {
      toast.error('Failed to fetch messages');
      console.error(error);
    }
  };

  const handleTicketClick = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    fetchMessages(ticket.id);
    setDialogOpen(true);
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      const updates: any = { status: newStatus, updated_at: new Date().toISOString() };
      
      if (newStatus === 'resolved' || newStatus === 'closed') {
        updates.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId);

      if (error) throw error;
      
      toast.success('Ticket status updated');
      fetchTickets();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket({ ...selectedTicket, status: newStatus as Ticket['status'] });
      }

      // Send notification email
      await supabase.functions.invoke('send-ticket-notification', {
        body: {
          ticketId,
          ticketSubject: selectedTicket?.subject || 'Your ticket',
          type: 'status_change',
          newStatus
        }
      });
    } catch (error: any) {
      toast.error('Failed to update status');
      console.error(error);
    }
  };

  const handlePriorityChange = async (ticketId: string, newPriority: Ticket['priority']) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ priority: newPriority, updated_at: new Date().toISOString() })
        .eq('id', ticketId);

      if (error) throw error;
      
      toast.success('Ticket priority updated');
      fetchTickets();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket({ ...selectedTicket, priority: newPriority });
      }
    } catch (error: any) {
      toast.error('Failed to update priority');
      console.error(error);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: selectedTicket.id,
        user_id: user.id,
        message: newMessage,
        is_admin: true,
      });

      if (error) throw error;

      toast.success('Message sent');
      setNewMessage('');
      fetchMessages(selectedTicket.id);

      // Send notification email to customer
      await supabase.functions.invoke('send-ticket-notification', {
        body: {
          ticketId: selectedTicket.id,
          ticketSubject: selectedTicket.subject,
          type: 'admin_reply'
        }
      });
    } catch (error: any) {
      toast.error('Failed to send message');
      console.error(error);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      open: 'default',
      in_progress: 'secondary',
      waiting_customer: 'outline',
      resolved: 'default',
      closed: 'secondary',
    };
    return <Badge variant={variants[status] || 'default'}>{status.replace('_', ' ')}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      urgent: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
    return <Badge className={colors[priority] || ''}>{priority}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-glow bg-clip-text text-transparent">
            {t.sidebar.supportTickets}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t.tickets.subtitle}
          </p>
        </div>
        {permissions?.isSuperAdmin && (
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => setResetDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Reset Tickets
          </Button>
        )}
      </div>

      <ResetSectionDialog
        section="tickets"
        sectionLabel="Support Tickets"
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onSuccess={fetchTickets}
      />

      <div className="flex gap-4">
        <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as typeof statusFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={(val) => setPriorityFilter(val as typeof priorityFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        </div>
      ) : (
        <div className="grid gap-4">
          {tickets.map((ticket) => (
            <Card key={ticket.id} className="glass-strong cursor-pointer hover:shadow-glow transition-smooth" onClick={() => handleTicketClick(ticket)}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      {ticket.subject}
                    </CardTitle>
                    <CardDescription className="mt-2 line-clamp-2">
                      {ticket.description}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {getStatusBadge(ticket.status)}
                    {getPriorityBadge(ticket.priority)}
                    {ticket.escalated && (
                      <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Escalated
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    {ticket.user_id.slice(0, 8)}...
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                  </div>
                  {ticket.order_id && (
                    <Badge variant="outline">Order: {ticket.order_id.slice(0, 8)}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {selectedTicket?.subject}
            </DialogTitle>
            <DialogDescription>
              Ticket ID: {selectedTicket?.id.slice(0, 13)}...
            </DialogDescription>
          </DialogHeader>

          {selectedTicket && (
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={selectedTicket.status} onValueChange={(val) => handleStatusChange(selectedTicket.id, val)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1">
                  <label className="text-sm font-medium">Priority</label>
                  <Select value={selectedTicket.priority} onValueChange={(val) => handlePriorityChange(selectedTicket.id, val as Ticket['priority'])}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="glass-strong rounded-lg p-4">
                <h3 className="font-semibold mb-2">Original Message</h3>
                <p className="text-sm text-muted-foreground">{selectedTicket.description}</p>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Conversation</h3>
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`p-3 rounded-lg ${msg.is_admin ? 'bg-primary/10 ml-8' : 'bg-muted mr-8'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={msg.is_admin ? 'default' : 'secondary'}>
                          {msg.is_admin ? 'Admin' : 'Customer'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm">{msg.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Reply to Customer</label>
                <Textarea
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  rows={4}
                />
                <Button onClick={handleSendMessage} disabled={!newMessage.trim()}>
                  Send Message
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
