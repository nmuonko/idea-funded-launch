 import { useState, useEffect, useRef } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { MessageCircle, X, Send, Loader2, User, Headphones } from 'lucide-react';
 import { useSupportChat } from '@/contexts/SupportChatContext';
 import { useAuth } from '@/contexts/AuthContext';
 import { useLanguage } from '@/contexts/LanguageContext';
 import { supabase } from '@/integrations/supabase/client';
 import { ScrollArea } from '@/components/ui/scroll-area';
 import { Input } from '@/components/ui/input';
 import { Button } from '@/components/ui/button';
 import { Badge } from '@/components/ui/badge';
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
 
 const translations = {
   fr: {
     title: 'Assistance',
     subtitle: 'Envoyez-nous un message',
     placeholder: 'Écrivez votre message...',
     loginRequired: 'Connectez-vous pour chatter',
     messageSent: 'Message envoyé! Nous vous répondrons par email.',
     connected: 'Connecté au support',
   },
   en: {
     title: 'Support',
     subtitle: 'Send us a message',
     placeholder: 'Type your message...',
     loginRequired: 'Log in to chat',
     messageSent: 'Message sent! We\'ll reply via email.',
     connected: 'Connected to support',
   },
   sw: {
     title: 'Msaada',
     subtitle: 'Tutumie ujumbe',
     placeholder: 'Andika ujumbe wako...',
     loginRequired: 'Ingia ili kuongea',
     messageSent: 'Ujumbe umetumwa! Tutajibu kupitia barua pepe.',
     connected: 'Imeunganishwa na msaada',
   },
   ln: {
     title: 'Lisungi',
     subtitle: 'Tindela biso message',
     placeholder: 'Koma message na yo...',
     loginRequired: 'Kota po osolola',
     messageSent: 'Message etindami! Tokozongisela yo na email.',
     connected: 'Okangami na lisungi',
   },
 };
 
 export function FloatingContactWidget() {
   const { isOpen, toggleChat } = useSupportChat();
   const [messages, setMessages] = useState<Message[]>([]);
   const [conversation, setConversation] = useState<Conversation | null>(null);
   const [inputValue, setInputValue] = useState('');
   const [loading, setLoading] = useState(false);
   const [sending, setSending] = useState(false);
   const messagesEndRef = useRef<HTMLDivElement>(null);
   const { user } = useAuth();
   const { language } = useLanguage();
 
   const t = translations[language as keyof typeof translations] || translations.en;
 
   const scrollToBottom = () => {
     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   };
 
   useEffect(() => {
     scrollToBottom();
   }, [messages]);
 
   // Load or create conversation when chat is opened - auto-escalate to agent
   useEffect(() => {
     if (!user || !isOpen) return;
 
     const loadConversation = async () => {
       setLoading(true);
       try {
         console.log('[CONTACT] Starting support conversation with auto-escalation...');
         const { data: startData, error: startError } = await supabase.functions.invoke('support-start', {
           body: {}
         });
 
         if (startError) {
           console.error('[CONTACT] support-start error:', startError);
           throw startError;
         }
 
         if (!startData?.ok || !startData?.conversation_id) {
           throw new Error(startData?.error || 'Failed to start chat');
         }
 
         const conversationId = startData.conversation_id;
         console.log('[CONTACT] Conversation started:', conversationId);
 
         // Fetch conversation details
         const { data: convoData, error: convoError } = await supabase
           .from('support_conversations')
           .select('*')
           .eq('id', conversationId)
           .single();
 
         if (convoError) throw convoError;
 
         setConversation(convoData as Conversation);
 
         // Auto-escalate to agent if not already escalated
         if (convoData.status === 'bot') {
           console.log('[CONTACT] Auto-escalating to agent...');
           await supabase
             .from('support_conversations')
             .update({ status: 'waiting_agent' })
             .eq('id', convoData.id);
           
           // Notify support agent
           await supabase.functions.invoke('notify-support-agent', {
             body: { conversation_id: convoData.id },
           });
           
           setConversation({ ...convoData, status: 'waiting_agent' } as Conversation);
         }
 
         // Load messages
         const { data: msgs } = await supabase
           .from('support_messages')
           .select('*')
           .eq('conversation_id', conversationId)
           .order('created_at', { ascending: true });
         
         setMessages((msgs || []) as Message[]);
       } catch (error) {
         console.error('[CONTACT] Error loading conversation:', error);
       } finally {
         setLoading(false);
       }
     };
 
     loadConversation();
   }, [user, isOpen]);
 
   // Subscribe to realtime messages
   useEffect(() => {
     if (!conversation?.id) return;
 
     const channel = supabase
       .channel(`floating_support_${conversation.id}`)
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
       console.log('[CONTACT] Sending message...');
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
         console.error('[CONTACT] Bot error:', error);
       }
 
       if (data?.escalated) {
         setConversation(prev => prev ? { ...prev, status: 'waiting_agent' } : null);
       }
     } catch (error) {
       console.error('[CONTACT] Error sending message:', error);
     } finally {
       setSending(false);
     }
   };
 
   return (
     <div className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
       <AnimatePresence>
         {isOpen && (
           <motion.div
             initial={{ opacity: 0, y: 20, scale: 0.9 }}
             animate={{ opacity: 1, y: 0, scale: 1 }}
             exit={{ opacity: 0, y: 20, scale: 0.9 }}
             transition={{ duration: 0.2 }}
             className="absolute bottom-16 right-0 bg-black/95 border border-white/10 rounded-2xl shadow-2xl w-[320px] md:w-[360px] overflow-hidden"
           >
             {/* Header */}
             <div className="bg-gradient-to-r from-primary/20 to-primary/10 px-4 py-3 border-b border-white/10">
                 <div className="flex items-center gap-2">
                   <Headphones className="h-5 w-5 text-primary" />
                   <div>
                     <h3 className="text-sm font-semibold text-white">{t.title}</h3>
                     <p className="text-xs text-white/60">{t.subtitle}</p>
                   </div>
               </div>
             </div>
 
             {/* Chat Area */}
             {user ? (
               <div className="flex flex-col h-[350px]">
                 {/* Messages */}
                 <ScrollArea className="flex-1 p-3">
                   {loading ? (
                     <div className="flex items-center justify-center h-full">
                       <Loader2 className="h-6 w-6 animate-spin text-white/50" />
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
                             'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                             msg.sender_type === 'user' 
                               ? 'bg-primary text-primary-foreground'
                             : 'bg-white/20'
                           )}>
                             {msg.sender_type === 'user' ? (
                               <User className="h-3.5 w-3.5" />
                             ) : (
                             <Headphones className="h-3.5 w-3.5" />
                             )}
                           </div>
                           <div className={cn(
                             'max-w-[75%] rounded-xl px-3 py-2 text-sm',
                             msg.sender_type === 'user'
                               ? 'bg-primary text-primary-foreground'
                               : 'bg-white/10 text-white'
                           )}>
                             {msg.content}
                           </div>
                         </div>
                       ))}
                       <div ref={messagesEndRef} />
                     </div>
                   )}
                 </ScrollArea>
 
                 {/* Input Area */}
                 <div className="p-3 border-t border-white/10 space-y-2">
                   <div className="flex gap-2">
                     <Input
                       placeholder={t.placeholder}
                       value={inputValue}
                       onChange={(e) => setInputValue(e.target.value)}
                       onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(inputValue)}
                       disabled={sending}
                       className="bg-white/10 border-white/20 text-white placeholder:text-white/40 text-sm"
                     />
                     <Button 
                       onClick={() => sendMessage(inputValue)} 
                       disabled={sending || !inputValue.trim()}
                       size="icon"
                       className="shrink-0"
                     >
                       {sending ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                       ) : (
                         <Send className="h-4 w-4" />
                       )}
                     </Button>
                   </div>
                     <p className="text-xs text-white/40 text-center">{t.connected}</p>
                 </div>
               </div>
             ) : (
                 /* Not logged in - show login prompt */
                 <div className="p-6">
                   <div className="text-center py-6">
                     <Headphones className="h-12 w-12 text-white/30 mx-auto mb-3" />
                   <p className="text-white/60 text-sm">{t.loginRequired}</p>
                   <Button
                     variant="outline"
                     size="sm"
                       className="mt-4"
                     onClick={() => window.location.href = '/auth/login'}
                   >
                     Sign In
                   </Button>
                 </div>
               </div>
             )}
           </motion.div>
         )}
       </AnimatePresence>
 
       {/* Main Toggle Button */}
       <motion.button
         whileHover={{ scale: 1.05 }}
         whileTap={{ scale: 0.95 }}
           onClick={toggleChat}
         className={`
           h-14 w-14 rounded-full shadow-lg flex items-center justify-center
           transition-colors duration-200
           ${isOpen 
             ? 'bg-white/20 hover:bg-white/30' 
             : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
           }
         `}
       >
         {isOpen ? (
           <X className="h-6 w-6 text-white" />
         ) : (
           <MessageCircle className="h-6 w-6 text-white" />
         )}
       </motion.button>
     </div>
   );
 }