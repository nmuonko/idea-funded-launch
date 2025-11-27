import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { MessageSquare, Send, AlertCircle, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { detectTicketPriority } from '@/utils/ticketPriority';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  order_id: string | null;
  rating: number | null;
  rated_at: string | null;
}

interface TicketMessage {
  id: string;
  message: string;
  is_admin: boolean;
  created_at: string;
}

export default function Support() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    priority: 'medium',
    order_id: '',
  });

  useEffect(() => {
    if (user) {
      fetchTickets();
    }
  }, [user]);

  const fetchTickets = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (error: any) {
      toast.error('Failed to load tickets');
      console.error(error);
    }
  };

  const fetchMessages = async (ticketId: string) => {
    try {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error: any) {
      toast.error('Failed to load messages');
      console.error(error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('Please log in to submit a ticket');
      return;
    }

    setLoading(true);
    try {
      // Auto-detect priority based on keywords
      const detectedPriority = detectTicketPriority(formData.subject, formData.description);
      
      const { error } = await supabase.from('support_tickets').insert([{
        user_id: user.id,
        subject: formData.subject,
        description: formData.description,
        priority: detectedPriority,
        order_id: formData.order_id || null,
      }]);

      if (error) throw error;

      toast.success('Support ticket submitted successfully!');
      if (detectedPriority === 'high') {
        toast.info('Your ticket has been marked as high priority based on the content');
      }
      setFormData({ subject: '', description: '', priority: 'medium', order_id: '' });
      setShowForm(false);
      fetchTickets();

      // Trigger email notification
      await supabase.functions.invoke('send-ticket-notification', {
        body: { ticketSubject: formData.subject, type: 'created' }
      });
    } catch (error: any) {
      toast.error('Failed to submit ticket');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleTicketClick = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    fetchMessages(ticket.id);
    setDialogOpen(true);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket || !user) return;

    try {
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: selectedTicket.id,
        user_id: user.id,
        message: newMessage,
        is_admin: false,
      });

      if (error) throw error;

      toast.success('Message sent');
      setNewMessage('');
      fetchMessages(selectedTicket.id);

      // Trigger email notification to admin
      await supabase.functions.invoke('send-ticket-notification', {
        body: { 
          ticketId: selectedTicket.id,
          ticketSubject: selectedTicket.subject,
          type: 'customer_reply'
        }
      });
    } catch (error: any) {
      toast.error('Failed to send message');
      console.error(error);
    }
  };

  const handleRateTicket = async (ticketId: string, rating: number) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          rating,
          rated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      if (error) throw error;

      toast.success('Thank you for your feedback!');
      fetchTickets();
    } catch (error: any) {
      toast.error('Failed to submit rating');
      console.error(error);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      open: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      in_progress: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      waiting_customer: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      resolved: 'bg-green-500/10 text-green-500 border-green-500/20',
      closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    };
    return <Badge className={variants[status] || ''}>{status.replace('_', ' ')}</Badge>;
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Login Required
            </CardTitle>
            <CardDescription>
              Please log in to access customer support
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-ocean bg-clip-text text-transparent">
              Customer Support
            </h1>
            <p className="text-muted-foreground mt-2">
              Submit tickets and track your support requests
            </p>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <MessageSquare className="h-4 w-4" />
            New Ticket
          </Button>
        </div>

        {showForm && (
          <Card className="glass-strong">
            <CardHeader>
              <CardTitle>Submit Support Ticket</CardTitle>
              <CardDescription>Describe your issue and we'll get back to you soon</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Subject</label>
                  <Input
                    placeholder="Brief description of your issue"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    placeholder="Provide detailed information about your issue"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={4}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Priority will be automatically assigned based on your issue description
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Order ID (Optional)</label>
                  <Input
                    placeholder="Related order ID if applicable"
                    value={formData.order_id}
                    onChange={(e) => setFormData({ ...formData, order_id: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Ticket'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Your Tickets</h2>
          {tickets.length === 0 ? (
            <Card className="glass-strong">
              <CardContent className="py-12 text-center text-muted-foreground">
                No support tickets yet. Click "New Ticket" to get started.
              </CardContent>
            </Card>
          ) : (
            tickets.map((ticket) => (
              <Card 
                key={ticket.id} 
                className="glass-strong cursor-pointer hover:shadow-glow transition-smooth"
                onClick={() => handleTicketClick(ticket)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5" />
                        {ticket.subject}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        Created {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {getStatusBadge(ticket.status)}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                {selectedTicket?.subject}
              </DialogTitle>
              <DialogDescription>
                {selectedTicket && getStatusBadge(selectedTicket.status)}
              </DialogDescription>
            </DialogHeader>

            {selectedTicket && (
              <div className="space-y-6">
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
                            {msg.is_admin ? 'Support Team' : 'You'}
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

                {(selectedTicket.status === 'resolved' || selectedTicket.status === 'closed') && !selectedTicket.rating && (
                  <div className="glass-strong rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold">Rate Your Support Experience</h3>
                    <p className="text-sm text-muted-foreground">How satisfied are you with the support you received?</p>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Button
                          key={star}
                          variant="outline"
                          size="sm"
                          onClick={() => handleRateTicket(selectedTicket.id, star)}
                          className="gap-1"
                        >
                          <Star className="h-4 w-4" fill={star <= 3 ? 'none' : 'currentColor'} />
                          {star}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.rating && (
                  <div className="glass-strong rounded-lg p-4">
                    <h3 className="font-semibold mb-2">Your Rating</h3>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className="h-5 w-5"
                          fill={star <= selectedTicket.rating! ? 'currentColor' : 'none'}
                          color={star <= selectedTicket.rating! ? '#fbbf24' : 'currentColor'}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.status !== 'closed' && selectedTicket.status !== 'resolved' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Reply</label>
                    <Textarea
                      placeholder="Type your message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      rows={4}
                    />
                    <Button onClick={handleSendMessage} disabled={!newMessage.trim()} className="gap-2">
                      <Send className="h-4 w-4" />
                      Send Message
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
