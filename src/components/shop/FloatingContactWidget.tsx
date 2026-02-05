 import { useState, useEffect, useRef } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { MessageCircle, X, Mail, Send, Loader2, User, Bot, Headphones, ChevronDown } from 'lucide-react';
 import { useAuth } from '@/contexts/AuthContext';
 import { useLanguage } from '@/contexts/LanguageContext';
 import { supabase } from '@/integrations/supabase/client';
 import { ScrollArea } from '@/components/ui/scroll-area';
 import { Input } from '@/components/ui/input';
 import { Button } from '@/components/ui/button';
 import { Badge } from '@/components/ui/badge';
 import { cn } from '@/lib/utils';
 import { getWhatsAppUrl, getEmailUrl, SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/supportConfig';
 
 // WhatsApp brand icon component
 function WhatsAppIcon({ className }: { className?: string }) {
   return (
     <svg viewBox="0 0 24 24" className={className} fill="currentColor">
       <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
     </svg>
   );
 }
 
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
     subtitle: 'Comment pouvons-nous vous aider?',
     placeholder: 'Écrivez votre message...',
     talkToAgent: 'Parler à un agent',
     waitingAgent: 'En attente d\'un agent...',
     agentConnected: 'Agent connecté',
     escalated: 'Je vous mets en relation avec un agent...',
     loginRequired: 'Connectez-vous pour chatter',
     otherOptions: 'Autres options',
   },
   en: {
     title: 'Support',
     subtitle: 'How can we help you?',
     placeholder: 'Type your message...',
     talkToAgent: 'Talk to an agent',
     waitingAgent: 'Waiting for an agent...',
     agentConnected: 'Agent connected',
     escalated: 'Connecting you with an agent...',
     loginRequired: 'Log in to chat',
     otherOptions: 'Other options',
   },
   sw: {
     title: 'Msaada',
     subtitle: 'Tunawezaje kukusaidia?',
     placeholder: 'Andika ujumbe wako...',
     talkToAgent: 'Ongea na wakala',
     waitingAgent: 'Kusubiri wakala...',
     agentConnected: 'Wakala ameunganishwa',
     escalated: 'Ninakuunganisha na wakala...',
     loginRequired: 'Ingia ili kuongea',
     otherOptions: 'Chaguzi nyingine',
   },
   ln: {
     title: 'Lisungi',
     subtitle: 'Ndenge nini tokoki kosalisa yo?',
     placeholder: 'Koma message na yo...',
     talkToAgent: 'Solola na agent',
     waitingAgent: 'Kozela agent...',
     agentConnected: 'Agent akangami',
     escalated: 'Nazali kokangisa yo na agent...',
     loginRequired: 'Kota po osolola',
     otherOptions: 'Baponi mosusu',
   },
 };
 
 export function FloatingContactWidget() {
   const [isOpen, setIsOpen] = useState(false);
   const [showOtherOptions, setShowOtherOptions] = useState(false);
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
 
   // Load or create conversation when chat is opened
   useEffect(() => {
     if (!user || !isOpen) return;
 
     const loadConversation = async () => {
       setLoading(true);
       try {
         console.log('[CONTACT] Starting support conversation...');
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
 
   const escalateToAgent = async () => {
     if (!conversation) return;
 
     setSending(true);
     try {
       console.log('[CONTACT] Escalating to agent...');
       await supabase
         .from('support_conversations')
         .update({ status: 'waiting_agent' })
         .eq('id', conversation.id);
 
       await supabase
         .from('support_messages')
         .insert({
           conversation_id: conversation.id,
           sender_type: 'bot',
           content: t.escalated,
         });
 
       setConversation(prev => prev ? { ...prev, status: 'waiting_agent' } : null);
 
       await supabase.functions.invoke('notify-support-agent', {
         body: { conversation_id: conversation.id },
       });
     } catch (error) {
       console.error('[CONTACT] Error escalating:', error);
     } finally {
       setSending(false);
     }
   };
 
   const handleWhatsAppClick = () => {
     console.log('[CONTACT] Opened WhatsApp');
     window.open(getWhatsAppUrl(user?.email), '_blank');
   };
 
   const handleEmailClick = () => {
     console.log('[CONTACT] Opened Email');
     window.location.href = getEmailUrl(user?.email);
   };
 
   const getStatusBadge = () => {
     if (!conversation) return null;
     
     switch (conversation.status) {
       case 'waiting_agent':
         return <Badge variant="secondary" className="animate-pulse text-xs">{t.waitingAgent}</Badge>;
       case 'assigned':
         return <Badge className="bg-green-600 text-xs">{t.agentConnected}</Badge>;
       default:
         return null;
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
               <div className="flex items-center justify-between">
                 <div>
                   <h3 className="text-sm font-semibold text-white">{t.title}</h3>
                   <p className="text-xs text-white/60">{t.subtitle}</p>
                 </div>
                 {getStatusBadge()}
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
                               : msg.sender_type === 'agent'
                               ? 'bg-green-600 text-white'
                               : 'bg-white/20'
                           )}>
                             {msg.sender_type === 'user' ? (
                               <User className="h-3.5 w-3.5" />
                             ) : msg.sender_type === 'agent' ? (
                               <Headphones className="h-3.5 w-3.5" />
                             ) : (
                               <Bot className="h-3.5 w-3.5" />
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
 
                   {/* Agent Button */}
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={escalateToAgent}
                     disabled={sending || conversation?.status === 'waiting_agent' || conversation?.status === 'assigned'}
                     className="w-full text-white/70 hover:text-white hover:bg-white/10 text-xs"
                   >
                     <Headphones className="mr-2 h-3.5 w-3.5" />
                     {t.talkToAgent}
                   </Button>
                 </div>
 
                 {/* Other Options (WhatsApp/Email) */}
                 <div className="border-t border-white/10">
                   <button
                     onClick={() => setShowOtherOptions(!showOtherOptions)}
                     className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors"
                   >
                     {t.otherOptions}
                     <ChevronDown className={cn("h-3 w-3 transition-transform", showOtherOptions && "rotate-180")} />
                   </button>
                   
                   <AnimatePresence>
                     {showOtherOptions && (
                       <motion.div
                         initial={{ height: 0, opacity: 0 }}
                         animate={{ height: 'auto', opacity: 1 }}
                         exit={{ height: 0, opacity: 0 }}
                         className="overflow-hidden"
                       >
                         <div className="px-3 pb-3 flex gap-2">
                           <button
                             onClick={handleWhatsAppClick}
                             className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition-colors text-xs text-white"
                           >
                             <WhatsAppIcon className="h-4 w-4" />
                             WhatsApp
                           </button>
                           <button
                             onClick={handleEmailClick}
                             className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-xs text-white"
                           >
                             <Mail className="h-4 w-4" />
                             Email
                           </button>
                         </div>
                       </motion.div>
                     )}
                   </AnimatePresence>
                 </div>
               </div>
             ) : (
               /* Not logged in - show login prompt + external options */
               <div className="p-4 space-y-4">
                 <div className="text-center py-4">
                   <MessageCircle className="h-10 w-10 text-white/30 mx-auto mb-2" />
                   <p className="text-white/60 text-sm">{t.loginRequired}</p>
                   <Button
                     variant="outline"
                     size="sm"
                     className="mt-3"
                     onClick={() => window.location.href = '/auth/login'}
                   >
                     Sign In
                   </Button>
                 </div>
 
                 <div className="border-t border-white/10 pt-4 space-y-2">
                   <p className="text-xs text-white/40 text-center mb-2">{t.otherOptions}</p>
                   <button
                     onClick={handleWhatsAppClick}
                     className="w-full flex items-center gap-3 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl transition-colors"
                   >
                     <WhatsAppIcon className="h-5 w-5 text-white" />
                     <div className="text-left">
                       <p className="text-white font-medium text-sm">WhatsApp</p>
                       <p className="text-white/70 text-xs">{SUPPORT_WHATSAPP_DISPLAY}</p>
                     </div>
                   </button>
                   <button
                     onClick={handleEmailClick}
                     className="w-full flex items-center gap-3 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
                   >
                     <Mail className="h-5 w-5 text-blue-400" />
                     <div className="text-left">
                       <p className="text-white font-medium text-sm">Email</p>
                       <p className="text-white/50 text-xs truncate max-w-[180px]">{SUPPORT_EMAIL}</p>
                     </div>
                   </button>
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
         onClick={() => setIsOpen(!isOpen)}
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