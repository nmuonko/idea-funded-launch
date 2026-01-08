
-- ============================================
-- FAQ Knowledge Base Table
-- ============================================
CREATE TABLE public.faq_kb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL DEFAULT 'fr',
  question text NOT NULL,
  answer text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  trigger_phrases text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for faq_kb
CREATE INDEX idx_faq_kb_tags ON public.faq_kb USING GIN (tags);
CREATE INDEX idx_faq_kb_trigger_phrases ON public.faq_kb USING GIN (trigger_phrases);
CREATE INDEX idx_faq_kb_language_active_priority ON public.faq_kb (language, is_active, priority DESC);

-- ============================================
-- Support Threads Table
-- ============================================
CREATE TABLE public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('open', 'waiting_admin', 'waiting_user', 'resolved'))
);

-- Indexes for support_threads
CREATE INDEX idx_support_threads_user_status ON public.support_threads (user_id, status);
CREATE INDEX idx_support_threads_last_message ON public.support_threads (last_message_at DESC);
CREATE INDEX idx_support_threads_status ON public.support_threads (status) WHERE status = 'waiting_admin';

-- ============================================
-- Thread Messages Table (named to avoid conflict with existing support_messages)
-- ============================================
CREATE TABLE public.thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_type text NOT NULL,
  sender_id uuid NULL,
  message text NOT NULL,
  source text NOT NULL DEFAULT 'freeform',
  faq_id uuid NULL REFERENCES public.faq_kb(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_sender_type CHECK (sender_type IN ('user', 'ai', 'admin')),
  CONSTRAINT valid_source CHECK (source IN ('faq_kb', 'freeform', 'admin_reply'))
);

-- Indexes for thread_messages
CREATE INDEX idx_thread_messages_thread_created ON public.thread_messages (thread_id, created_at);

-- ============================================
-- Updated_at Trigger for faq_kb
-- ============================================
CREATE OR REPLACE FUNCTION public.update_faq_kb_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trigger_faq_kb_updated_at
  BEFORE UPDATE ON public.faq_kb
  FOR EACH ROW
  EXECUTE FUNCTION public.update_faq_kb_updated_at();

-- ============================================
-- Enable RLS
-- ============================================
ALTER TABLE public.faq_kb ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for faq_kb
-- ============================================
CREATE POLICY "Authenticated users can read active FAQs"
  ON public.faq_kb FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage all FAQs"
  ON public.faq_kb FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================
-- RLS Policies for support_threads
-- ============================================
CREATE POLICY "Users can view their own threads"
  ON public.support_threads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own threads"
  ON public.support_threads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own threads"
  ON public.support_threads FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all threads"
  ON public.support_threads FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update all threads"
  ON public.support_threads FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================
-- RLS Policies for thread_messages
-- ============================================
CREATE POLICY "Users can view messages in their threads"
  ON public.thread_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_threads
      WHERE support_threads.id = thread_messages.thread_id
      AND support_threads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in their threads"
  ON public.thread_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_type = 'user'
    AND EXISTS (
      SELECT 1 FROM public.support_threads
      WHERE support_threads.id = thread_messages.thread_id
      AND support_threads.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all messages"
  ON public.thread_messages FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert messages"
  ON public.thread_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    AND sender_type IN ('admin', 'ai')
  );

-- ============================================
-- Service role policy for AI messages
-- ============================================
CREATE POLICY "Service role can insert any message"
  ON public.thread_messages FOR INSERT
  WITH CHECK (true);

-- ============================================
-- match_faq RPC Function
-- ============================================
CREATE OR REPLACE FUNCTION public.match_faq(user_text text, lang text DEFAULT 'fr')
RETURNS TABLE (
  id uuid,
  question text,
  answer text,
  tags text[],
  trigger_phrases text[],
  priority int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_text text;
BEGIN
  -- Normalize: lowercase and remove punctuation
  normalized_text := lower(regexp_replace(user_text, '[^\w\s]', '', 'g'));
  
  RETURN QUERY
  SELECT 
    f.id,
    f.question,
    f.answer,
    f.tags,
    f.trigger_phrases,
    f.priority
  FROM public.faq_kb f
  WHERE f.is_active = true
    AND f.language = lang
    AND (
      -- Exact match on normalized question
      lower(regexp_replace(f.question, '[^\w\s]', '', 'g')) = normalized_text
      -- Or any trigger phrase appears in user text
      OR EXISTS (
        SELECT 1 FROM unnest(f.trigger_phrases) AS tp
        WHERE normalized_text ILIKE '%' || lower(tp) || '%'
      )
      -- Or any tag keyword appears in user text
      OR EXISTS (
        SELECT 1 FROM unnest(f.tags) AS t
        WHERE normalized_text ILIKE '%' || lower(t) || '%'
      )
    )
  ORDER BY
    -- Exact question match first
    CASE WHEN lower(regexp_replace(f.question, '[^\w\s]', '', 'g')) = normalized_text THEN 0 ELSE 1 END,
    f.priority DESC,
    f.created_at DESC
  LIMIT 1;
END;
$$;

-- ============================================
-- Enable realtime for support tables
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.thread_messages;

-- ============================================
-- SEED DATA: French FAQs (20 items)
-- ============================================
INSERT INTO public.faq_kb (language, question, answer, tags, trigger_phrases, priority) VALUES
('fr', 'Quel est le délai de livraison ?', 'Le délai de livraison est généralement de 2 à 4 semaines selon la destination et le type de produit.', ARRAY['livraison', 'délai', 'temps'], ARRAY['combien de temps', 'délai livraison', 'quand livré', 'temps de livraison'], 10),
('fr', 'Pourquoi ma commande est-elle en retard ?', 'Les retards peuvent être dus aux douanes, à la logistique internationale ou aux conditions météo. Contactez-nous pour le suivi.', ARRAY['retard', 'attente', 'lent'], ARRAY['commande retard', 'pourquoi retard', 'en retard', 'pas encore reçu'], 9),
('fr', 'Comment fonctionne la tarification ?', 'Le prix inclut le produit, les frais de service (10-15%), et l''expédition. Le tout est converti en CDF selon le taux du jour.', ARRAY['prix', 'tarif', 'coût'], ARRAY['comment prix', 'pourquoi cher', 'calcul prix', 'frais'], 8),
('fr', 'Comment coller un lien produit ?', 'Copiez l''URL du produit sur Amazon, Alibaba ou autre site, puis collez-la dans notre application pour obtenir un devis.', ARRAY['lien', 'url', 'coller'], ARRAY['comment coller', 'ajouter lien', 'copier url', 'mettre lien'], 8),
('fr', 'Quels moyens de paiement acceptez-vous ?', 'Nous acceptons MaishaPay (mobile money), virement bancaire et paiement en espèces pour certaines zones.', ARRAY['paiement', 'payer', 'argent'], ARRAY['comment payer', 'moyen paiement', 'mobile money', 'maishapay'], 9),
('fr', 'Puis-je annuler ma commande ?', 'Oui, si la commande n''a pas encore été expédiée. Contactez-nous rapidement pour une annulation.', ARRAY['annuler', 'annulation', 'cancel'], ARRAY['annuler commande', 'je veux annuler', 'supprimer commande'], 7),
('fr', 'Comment obtenir un remboursement ?', 'Les remboursements sont possibles pour produits non livrés ou endommagés. Contactez le support avec votre numéro de commande.', ARRAY['remboursement', 'rembourser', 'argent retour'], ARRAY['remboursement', 'récupérer argent', 'argent retour'], 7),
('fr', 'Où puis-je suivre ma commande ?', 'Allez dans "Mes Commandes" pour voir le statut. Vous recevrez aussi des notifications par email/SMS.', ARRAY['suivi', 'tracking', 'statut'], ARRAY['suivre commande', 'où est ma commande', 'statut commande', 'tracking'], 9),
('fr', 'Livrez-vous à Kinshasa ?', 'Oui, nous livrons à Kinshasa et dans plusieurs autres villes de la RDC.', ARRAY['kinshasa', 'livraison', 'ville'], ARRAY['livraison kinshasa', 'kinshasa', 'goma', 'lubumbashi'], 6),
('fr', 'Puis-je commander depuis Amazon ?', 'Oui ! Copiez le lien Amazon et collez-le dans notre app. Nous gérons l''achat et la livraison.', ARRAY['amazon', 'site', 'commander'], ARRAY['amazon', 'commander amazon', 'acheter amazon'], 8),
('fr', 'Comment contacter le support ?', 'Envoyez un message ici ou écrivez à support@afrishop.com. Réponse sous 24h.', ARRAY['support', 'contact', 'aide'], ARRAY['contacter', 'parler agent', 'aide', 'support'], 10),
('fr', 'Les prix sont-ils en dollars ou en francs ?', 'Les prix sont affichés en USD et CDF. Le taux de change est mis à jour quotidiennement.', ARRAY['dollar', 'franc', 'devise', 'cdf', 'usd'], ARRAY['prix dollar', 'prix franc', 'devise', 'taux change'], 7),
('fr', 'Que faire si mon produit est endommagé ?', 'Prenez des photos et contactez-nous dans les 48h après réception. Nous traiterons votre réclamation.', ARRAY['endommagé', 'cassé', 'défaut'], ARRAY['produit cassé', 'endommagé', 'défectueux', 'problème produit'], 8),
('fr', 'Comment modifier ma commande ?', 'Contactez-nous avant que la commande soit confirmée. Après confirmation, les modifications ne sont plus possibles.', ARRAY['modifier', 'changer', 'éditer'], ARRAY['modifier commande', 'changer commande', 'éditer'], 6),
('fr', 'Quels sites puis-je utiliser ?', 'Vous pouvez commander depuis Amazon, Alibaba, AliExpress, eBay et d''autres sites internationaux.', ARRAY['site', 'amazon', 'alibaba', 'ebay'], ARRAY['quel site', 'sites acceptés', 'alibaba', 'aliexpress'], 7),
('fr', 'Dois-je payer les frais de douane ?', 'Nos prix incluent généralement les frais de douane estimés. Aucun frais surprise à la livraison.', ARRAY['douane', 'taxe', 'frais'], ARRAY['frais douane', 'taxe', 'payer douane'], 8),
('fr', 'Comment créer un compte ?', 'Téléchargez l''app, entrez votre numéro de téléphone et suivez les instructions pour créer votre compte.', ARRAY['compte', 'inscription', 'créer'], ARRAY['créer compte', 'inscription', 's''inscrire', 'nouveau compte'], 7),
('fr', 'Puis-je payer en plusieurs fois ?', 'Actuellement, nous n''offrons pas le paiement échelonné. Le paiement complet est requis avant expédition.', ARRAY['paiement', 'échelonné', 'plusieurs fois'], ARRAY['payer plusieurs fois', 'échelonné', 'crédit'], 5),
('fr', 'Quelle est la politique de retour ?', 'Les retours sont acceptés pour produits défectueux ou non conformes, dans un délai de 7 jours après réception.', ARRAY['retour', 'renvoyer', 'politique'], ARRAY['retourner produit', 'politique retour', 'renvoyer'], 6),
('fr', 'Comment obtenir une facture ?', 'Votre facture est disponible dans "Mes Commandes". Vous pouvez la télécharger en PDF.', ARRAY['facture', 'reçu', 'document'], ARRAY['facture', 'obtenir facture', 'reçu', 'preuve achat'], 5);

-- ============================================
-- SEED DATA: English FAQs (10 items)
-- ============================================
INSERT INTO public.faq_kb (language, question, answer, tags, trigger_phrases, priority) VALUES
('en', 'What is the delivery time?', 'Delivery typically takes 2-4 weeks depending on destination and product type.', ARRAY['delivery', 'time', 'shipping'], ARRAY['how long', 'delivery time', 'when delivered', 'shipping time'], 10),
('en', 'Why is my order delayed?', 'Delays can occur due to customs, international logistics, or weather conditions. Contact us for tracking.', ARRAY['delay', 'late', 'waiting'], ARRAY['order delayed', 'why late', 'not received'], 9),
('en', 'How does pricing work?', 'Price includes the product, service fees (10-15%), and shipping. Everything is converted to CDF at daily rates.', ARRAY['price', 'cost', 'fee'], ARRAY['how price', 'why expensive', 'price calculation', 'fees'], 8),
('en', 'How do I paste a product link?', 'Copy the product URL from Amazon, Alibaba or other sites, then paste it in our app to get a quote.', ARRAY['link', 'url', 'paste'], ARRAY['how to paste', 'add link', 'copy url', 'paste link'], 8),
('en', 'What payment methods do you accept?', 'We accept MaishaPay (mobile money), bank transfer, and cash payment in certain areas.', ARRAY['payment', 'pay', 'money'], ARRAY['how to pay', 'payment method', 'mobile money', 'maishapay'], 9),
('en', 'Can I cancel my order?', 'Yes, if the order has not been shipped yet. Contact us quickly for cancellation.', ARRAY['cancel', 'cancellation'], ARRAY['cancel order', 'want to cancel', 'delete order'], 7),
('en', 'How do I get a refund?', 'Refunds are available for undelivered or damaged products. Contact support with your order number.', ARRAY['refund', 'money back'], ARRAY['refund', 'get money back', 'return money'], 7),
('en', 'Where can I track my order?', 'Go to "My Orders" to see the status. You will also receive email/SMS notifications.', ARRAY['track', 'tracking', 'status'], ARRAY['track order', 'where is my order', 'order status', 'tracking'], 9),
('en', 'Do you deliver to Kinshasa?', 'Yes, we deliver to Kinshasa and several other cities in DRC.', ARRAY['kinshasa', 'delivery', 'city'], ARRAY['delivery kinshasa', 'kinshasa', 'goma', 'lubumbashi'], 6),
('en', 'How do I contact support?', 'Send a message here or email support@afrishop.com. Response within 24h.', ARRAY['support', 'contact', 'help'], ARRAY['contact', 'talk to agent', 'help', 'support'], 10);
