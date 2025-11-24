import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Loader2, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface LogEntry {
  id: string;
  admin_email: string;
  timestamp: string;
  action_description: string;
  success: boolean;
  error_message?: string;
}

export default function CommandCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your AI Command Center assistant. I can help you manage AfriFund by understanding natural language commands. Try asking me to:\n\n• Change text on the homepage\n• Update session settings\n• Add winners\n• Modify feature flags\n• Adjust theme colors\n\nWhat would you like to do?',
      timestamp: new Date()
    }
  ]);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    command: string;
    message: string;
  } | null>(null);

  // Fetch recent logs
  const { data: logs } = useQuery({
    queryKey: ['aiCommandLogs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_ai_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as LogEntry[];
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Execute command mutation
  const executeMutation = useMutation({
    mutationFn: async (cmd: string) => {
      const { data, error } = await supabase.functions.invoke('ai-command-center', {
        body: {
          command: cmd
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.requiresConfirmation) {
        // Show confirmation dialog
        setPendingConfirmation({
          command: command,
          message: data.confirmationMessage
        });
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.responseMessage,
          timestamp: new Date()
        }]);
      } else {
        // Success
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.responseMessage || 'Done! The change has been applied.',
          timestamp: new Date()
        }]);
        
        toast({
          title: 'Success',
          description: 'Command executed successfully',
        });

        // Invalidate relevant queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['aiCommandLogs'] });
      }
      setCommand('');
    },
    onError: (error: any) => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message || 'Unknown error'}`,
        timestamp: new Date()
      }]);
      
      toast({
        title: 'Error',
        description: error.message || 'Failed to execute command',
        variant: 'destructive',
      });
    }
  });

  const handleSend = () => {
    if (!command.trim()) return;

    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: command,
      timestamp: new Date()
    }]);

    // Execute command
    executeMutation.mutate(command);
  };

  const handleConfirm = () => {
    if (pendingConfirmation) {
      executeMutation.mutate(`CONFIRM: ${pendingConfirmation.command}`);
      setPendingConfirmation(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            AI Command Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Control your app with natural language commands
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open('/', '_blank')}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Preview Site
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <Card className="h-[calc(100vh-16rem)]">
            <CardHeader>
              <CardTitle>Command Interface</CardTitle>
              <CardDescription>
                Type your instructions in natural language (English or French)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col h-[calc(100%-5rem)]">
              {/* Messages */}
              <ScrollArea className="flex-1 pr-4 mb-4">
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {msg.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                  {executeMutation.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg p-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="flex gap-2">
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder='Try: "Change the homepage title to My New Title"'
                  disabled={executeMutation.isPending}
                />
                <Button
                  onClick={handleSend}
                  disabled={!command.trim() || executeMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Changes Log */}
        <div className="lg:col-span-1">
          <Card className="h-[calc(100vh-16rem)]">
            <CardHeader>
              <CardTitle className="text-lg">Recent Changes</CardTitle>
              <CardDescription>
                Last 10 actions from the Command Center
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-22rem)]">
                <div className="space-y-3">
                  {logs?.map((log) => (
                    <div
                      key={log.id}
                      className="border rounded-lg p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant={log.success ? 'default' : 'destructive'}>
                          {log.success ? 'Success' : 'Failed'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm">{log.action_description}</p>
                      {log.error_message && (
                        <p className="text-xs text-destructive">
                          {log.error_message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        by {log.admin_email}
                      </p>
                    </div>
                  ))}
                  {!logs || logs.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No actions yet
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Examples Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Example Commands</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              'Change the homepage title to "Turn Your Idea into Reality"',
              'Set the active session target to 750 applicants',
              'Add a winner named Marie from DRC with project AgriTech, award $1000',
              'Turn off voice submissions',
              'Change the primary color to dark blue',
              'Update the How It Works intro text'
            ].map((example, idx) => (
              <Button
                key={idx}
                variant="outline"
                className="justify-start text-left h-auto py-2"
                onClick={() => setCommand(example)}
              >
                <span className="text-sm">{example}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!pendingConfirmation} onOpenChange={(open) => !open && setPendingConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Confirmation Required
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirmation?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}