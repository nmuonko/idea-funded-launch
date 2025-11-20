import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Eye, Mail, Phone, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Label } from '@/components/ui/label';

export default function AdminContacts() {
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  const { data: messages } = useQuery({
    queryKey: ['adminContacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold mb-2">Contact Messages</h1>
        <p className="text-muted-foreground">View and manage inbox messages</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{messages?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-secondary">
              {messages?.filter(m => 
                new Date(m.created_at).toDateString() === new Date().toDateString()
              ).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-info">
              {messages?.filter(m => {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                return new Date(m.created_at) > weekAgo;
              }).length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-strong">
        <CardHeader>
          <CardTitle>All Messages</CardTitle>
          <CardDescription>Contact form submissions from users</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages?.map((message) => (
                <TableRow key={message.id}>
                  <TableCell className="font-medium">{message.full_name}</TableCell>
                  <TableCell>{message.email}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{message.subject}</TableCell>
                  <TableCell>{new Date(message.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedMessage(message)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl glass-strong">
                        <DialogHeader>
                          <DialogTitle>Message from {message.full_name}</DialogTitle>
                          <DialogDescription>
                            Received on {new Date(message.created_at).toLocaleString()}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <Label className="text-xs text-muted-foreground">Email</Label>
                                <p className="text-sm font-medium">{message.email}</p>
                              </div>
                            </div>
                            {message.whatsapp_number && (
                              <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <div>
                                  <Label className="text-xs text-muted-foreground">WhatsApp</Label>
                                  <p className="text-sm font-medium">{message.whatsapp_number}</p>
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Subject</Label>
                            <p className="font-semibold text-lg mt-1">{message.subject}</p>
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Message</Label>
                            <div className="mt-2 p-4 bg-muted/50 rounded-lg">
                              <p className="whitespace-pre-wrap">{message.message}</p>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-4 border-t">
                            <Button asChild className="flex-1">
                              <a href={`mailto:${message.email}?subject=Re: ${message.subject}`}>
                                <Mail className="h-4 w-4 mr-2" />
                                Reply via Email
                              </a>
                            </Button>
                            {message.whatsapp_number && (
                              <Button variant="outline" asChild className="flex-1">
                                <a 
                                  href={`https://wa.me/${message.whatsapp_number.replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Phone className="h-4 w-4 mr-2" />
                                  WhatsApp
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
