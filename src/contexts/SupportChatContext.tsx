 import { createContext, useContext, useState, ReactNode } from 'react';
 
 interface SupportChatContextType {
   isOpen: boolean;
   openChat: () => void;
   closeChat: () => void;
   toggleChat: () => void;
 }
 
 const SupportChatContext = createContext<SupportChatContextType | undefined>(undefined);
 
 export function SupportChatProvider({ children }: { children: ReactNode }) {
   const [isOpen, setIsOpen] = useState(false);
 
   const openChat = () => setIsOpen(true);
   const closeChat = () => setIsOpen(false);
   const toggleChat = () => setIsOpen((prev) => !prev);
 
   return (
     <SupportChatContext.Provider value={{ isOpen, openChat, closeChat, toggleChat }}>
       {children}
     </SupportChatContext.Provider>
   );
 }
 
 export function useSupportChat() {
   const context = useContext(SupportChatContext);
   if (context === undefined) {
     throw new Error('useSupportChat must be used within a SupportChatProvider');
   }
   return context;
 }