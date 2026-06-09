import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Loader2, Check, CheckCheck, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAfriShopChatbot } from '@/contexts/AfriShopChatbotContext';
import { getWhatsAppUrl, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/supportConfig';
import { cn } from '@/lib/utils';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  escalate?: boolean;
}

const QUICK_REPLIES = [
  'Confirmer la disponibilité',
  'Comment payer ?',
  'Délai de livraison',
  'Frais de livraison',
  'Statut de ma commande',
];

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderMessageContent(text: string) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRe);
  return parts.map((part, i) => {
    if (urlRe.test(part)) {
      urlRe.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[#53bdeb] break-all font-medium"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function getSessionId() {
  try {
    let s = localStorage.getItem('afrishop_chatbot_session');
    if (!s) { s = crypto.randomUUID(); localStorage.setItem('afrishop_chatbot_session', s); }
    return s;
  } catch { return crypto.randomUUID(); }
}

const STORAGE_PREFIX = 'afrishop_chatbot_msgs:';
function storageKey(productId?: string | null) {
  return `${STORAGE_PREFIX}${productId || 'general'}`;
}
function loadStoredMessages(productId?: string | null): ChatMsg[] {
  try {
    const raw = localStorage.getItem(storageKey(productId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function AfriShopChatbotWidget() {
  const { isOpen, product, open, close } = useAfriShopChatbot();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadStoredMessages(product?.id));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);


  // Greeting only if no stored history
  useEffect(() => {
    if (!isOpen) return;
    if (messages.length > 0) return;
    const greet = product?.title
      ? `Bonjour 👋\nJe vois que vous êtes intéressé par : ${product.title}.\n${product.price_usd != null ? `Prix : ${product.price_usd} USD${product.price_cdf ? ` / ~${product.price_cdf.toLocaleString('fr-FR')} CDF` : ''}.\n` : ''}Voulez-vous que je vous aide avant le paiement ?`
      : `Bonjour 👋 Je suis Sophie. Comment puis-je vous aider ?`;
    setMessages([{ id: crypto.randomUUID(), role: 'assistant', content: greet, ts: Date.now() }]);
  }, [isOpen, product, messages.length]);

  // Load stored history when product context changes
  useEffect(() => {
    setMessages(loadStoredMessages(product?.id));
    setConversationId(null);
  }, [product?.id]);

  // Persist messages so they survive page refresh
  useEffect(() => {
    try {
      const key = storageKey(product?.id);
      if (messages.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(messages.slice(-50)));
    } catch { /* ignore quota */ }
  }, [messages, product?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Lock background scroll while chat is open.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // On mobile, hide the shop page behind the chat so iOS keyboard translucency never shows products.
  useEffect(() => {
    if (!isOpen) return;
    const isDesktop = window.matchMedia('(min-width: 640px)').matches;
    if (isDesktop) return;

    const root = document.getElementById('root');
    const prevRootVisibility = root?.style.visibility ?? '';
    const prevBodyBackground = document.body.style.backgroundColor;
    const prevHtmlBackground = document.documentElement.style.backgroundColor;

    if (root) root.style.visibility = 'hidden';
    document.body.style.backgroundColor = '#0b141a';
    document.documentElement.style.backgroundColor = '#0b141a';

    return () => {
      if (root) root.style.visibility = prevRootVisibility;
      document.body.style.backgroundColor = prevBodyBackground;
      document.documentElement.style.backgroundColor = prevHtmlBackground;
    };
  }, [isOpen]);

  // Track mobile keyboard via visualViewport so the panel (header + input) stays fully visible.
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const isDesktop = window.matchMedia('(min-width: 640px)').matches;
    if (isDesktop) return;
    const panel = panelRef.current;

    const apply = () => {
      if (!panel) return;
      panel.style.height = `${vv.height}px`;
      panel.style.top = `${vv.offsetTop}px`;
      panel.style.bottom = 'auto';
      // Keep latest message in view when keyboard opens
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      if (panel) { panel.style.height = ''; panel.style.top = ''; panel.style.bottom = ''; }
    };
  }, [isOpen]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: trimmed, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setSending(true);

    const startedAt = Date.now();
    try {
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('chatbot-ask', {
        body: {
          message: trimmed,
          session_id: getSessionId(),
          conversation_id: conversationId,
          product,
          history,
          language: 'fr',
          user_id: user?.id ?? null,
        },
      });
      if (error) throw error;
      if (data?.conversation_id && !conversationId) setConversationId(data.conversation_id);
      const answer = data?.answer || "Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte.";
      const escalate = !!data?.needs_escalation;

      // Human-like typing delay: 1–2s short, 2–3s longer
      const isLong = answer.length > 140;
      const targetDelay = isLong
        ? 2000 + Math.random() * 1000
        : 1000 + Math.random() * 1000;
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, targetDelay - elapsed);
      await new Promise(r => setTimeout(r, wait));

      setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', content: answer, ts: Date.now(), escalate }]);
    } catch (e) {
      const elapsed = Date.now() - startedAt;
      await new Promise(r => setTimeout(r, Math.max(0, 1200 - elapsed)));
      setMessages(m => [...m, {
        id: crypto.randomUUID(), role: 'assistant', ts: Date.now(), escalate: true,
        content: "Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte.",
      }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating bubble removed — chat opens only from per-product "Discuter avec Sophie" buttons */}

      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="fixed inset-0 z-[69] bg-[#0b141a] sm:hidden"
            />
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 sm:inset-auto sm:right-4 sm:bottom-4 z-[70] h-[100dvh] max-h-[100dvh] sm:h-[600px] sm:max-h-[85vh] sm:w-[380px] flex flex-col bg-[#0b141a] sm:rounded-2xl shadow-2xl overflow-hidden border border-white/5"
              style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
            {/* Header — WhatsApp green, app-page style on mobile */}
            <div className="flex items-center gap-2 px-2 sm:px-3 py-2.5 bg-[#075E54] text-white">
              <button onClick={close} aria-label="Retour" className="sm:hidden p-2 -ml-1 rounded-full hover:bg-white/10">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center font-bold">S</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm leading-tight">Sophie</div>
                <div className="text-[11px] text-white/70 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400"></span> en ligne
                </div>
              </div>
              <button onClick={close} aria-label="Fermer" className="hidden sm:inline-flex p-2 rounded-full hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages — WhatsApp chat bg */}
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1.5"
              style={{
                backgroundColor: '#0b141a',
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><circle cx='2' cy='2' r='1' fill='%23ffffff' fill-opacity='0.03'/></svg>\")",
              }}
            >
              {product?.title && (
                <div className="mb-2 rounded-lg bg-white/5 border border-white/10 p-2 flex gap-2 items-center">
                  {product.image && <img src={product.image} alt="" className="w-10 h-10 rounded object-cover bg-white" />}
                  <div className="text-xs text-white/80 leading-tight">
                    <div className="font-semibold line-clamp-1">{product.title}</div>
                    {product.price_usd != null && (
                      <div className="text-white/60">{product.price_usd} USD{product.price_cdf ? ` · ~${product.price_cdf.toLocaleString('fr-FR')} CDF` : ''}</div>
                    )}
                  </div>
                </div>
              )}

              {messages.map(m => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words shadow-sm',
                      m.role === 'user'
                        ? 'bg-[#005C4B] text-white rounded-tr-none'
                        : 'bg-[#202C33] text-white/95 rounded-tl-none'
                    )}
                  >
                    <div>{renderMessageContent(m.content)}</div>
                    <div className={cn('text-[10px] mt-0.5 flex items-center gap-0.5 justify-end', m.role === 'user' ? 'text-white/60' : 'text-white/40')}>
                      <span>{formatTime(m.ts)}</span>
                      {m.role === 'user' && <CheckCheck className="w-3 h-3" />}
                    </div>
                    {m.escalate && m.role === 'assistant' && (
                      <a
                        href={getWhatsAppUrl(user?.email)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-semibold"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Contacter un agent sur WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="flex flex-col items-start gap-1">
                    <div className="text-[10px] text-white/50 px-1">Sophie est en train d'écrire…</div>
                    <div className="bg-[#202C33] rounded-lg rounded-tl-none px-3 py-2 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 bg-white/60 rounded-full animate-bounce" />
                    </div>
                  </div>
                </div>
              )}

              {messages.length <= 1 && !sending && (
                <div className="pt-2 flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map(q => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-white/90 border border-white/10"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex items-center gap-2 px-2 py-2 bg-[#1f2c33] border-t border-white/5"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Écrivez un message…"
                className="flex-1 min-w-0 bg-[#2a3942] text-white text-base sm:text-sm placeholder:text-white/40 rounded-full px-4 py-2.5 outline-none focus:ring-2 focus:ring-[#25D366]/40"
                disabled={sending}
                enterKeyHint="send"
                inputMode="text"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                aria-label="Envoyer"
                className="shrink-0 h-10 w-10 rounded-full bg-[#25D366] hover:bg-[#1da851] disabled:opacity-50 text-white flex items-center justify-center"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </form>
            <div className="hidden sm:block text-[10px] text-center text-white/30 py-1 bg-[#1f2c33]">AfriShop AI · escalade humaine: {SUPPORT_WHATSAPP_DISPLAY}</div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}
    </>
  );
}
