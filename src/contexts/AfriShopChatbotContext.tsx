import { createContext, useCallback, useContext, useState, ReactNode } from 'react';

export interface ChatbotProductContext {
  id?: string;
  title?: string;
  price_usd?: number;
  price_cdf?: number;
  image?: string;
  link?: string;
  category?: string;
}

interface ChatbotCtx {
  isOpen: boolean;
  product: ChatbotProductContext | null;
  open: (product?: ChatbotProductContext) => void;
  close: () => void;
}

const Ctx = createContext<ChatbotCtx | null>(null);

export function AfriShopChatbotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [product, setProduct] = useState<ChatbotProductContext | null>(null);

  const open = useCallback((p?: ChatbotProductContext) => {
    setProduct(p ?? null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return <Ctx.Provider value={{ isOpen, product, open, close }}>{children}</Ctx.Provider>;
}

export function useAfriShopChatbot() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAfriShopChatbot must be inside AfriShopChatbotProvider');
  return ctx;
}
