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
  restricted: boolean;
  open: (product?: ChatbotProductContext, opts?: { restricted?: boolean }) => void;
  close: () => void;
}

const Ctx = createContext<ChatbotCtx | null>(null);

export function AfriShopChatbotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [product, setProduct] = useState<ChatbotProductContext | null>(null);
  const [restricted, setRestricted] = useState(false);

  const open = useCallback((p?: ChatbotProductContext, opts?: { restricted?: boolean }) => {
    setProduct(p ?? null);
    setRestricted(!!opts?.restricted);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return <Ctx.Provider value={{ isOpen, product, restricted, open, close }}>{children}</Ctx.Provider>;
}

export function useAfriShopChatbot() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAfriShopChatbot must be inside AfriShopChatbotProvider');
  return ctx;
}
