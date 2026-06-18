
-- 1) Remove old FAQs the team flagged
DELETE FROM public.faq_kb
WHERE id IN (
  'c5bd9c63-37ac-4e1b-a026-1f2487ab083b', -- en: How long for a refund?
  '3dbf37a4-92ae-482b-9a86-1df662156d39', -- en: How do I paste a product link?
  'd917226b-cad3-4c13-a510-fbb9b1421d68', -- en: How do I get a refund?
  '82e547d6-266f-4146-89a4-5b604b83bcd5', -- fr: Combien de temps pour un remboursement ?
  '1bd5bd48-9db2-4c90-a174-69d129ca9c94', -- fr: Comment savoir si un produit est disponible ?
  'e0da69cc-6c73-40a3-9c66-711095b70085', -- fr: Comment obtenir un remboursement ?
  'b7a5f60e-fc0f-4eb6-827c-aacc0b51a612', -- ln: Remboursement esalaka mikolo boni?
  '923ca2ff-de1a-4a44-9d16-ae3b34b1a763'  -- ln: Ndenge nini koyeba soki eloko ezali?
);

-- 2) Add new gap-coverage FAQs
INSERT INTO public.faq_kb (language, question, answer, tags, trigger_phrases, is_active, priority) VALUES
-- Pickup / agencies
('fr','Où récupérer ma commande ? Sur quelle agence ?','Nous livrons directement à votre adresse à Kinshasa. Hors Kinshasa (Lubumbashi, Mbujimayi, Goma, Bukavu, Matadi, Kisangani, etc.), nous travaillons avec un partenaire de transport local — dès que votre colis arrive en RDC, notre équipe vous appelle pour confirmer le point de retrait le plus proche de chez vous.',
ARRAY['pickup','agence','livraison','retrait','ville'],
ARRAY['agence','quelle agence','sur quelle agence','où récupérer','où retirer','point de retrait','mbujimayi','lubumbashi','goma','bukavu','matadi','kisangani','je peux le retrouver','où le récupérer'],
true,82),

('en','Where do I pick up my order? Which agency?','We deliver directly to your address in Kinshasa. Outside Kinshasa (Lubumbashi, Mbujimayi, Goma, Bukavu, Matadi, Kisangani, etc.), we use a trusted local transport partner — once your parcel reaches DRC, our team calls you to confirm the nearest pickup point.',
ARRAY['pickup','agency','delivery','outside_kinshasa'],
ARRAY['pickup','which agency','where do i pick','pick up location','agency','lubumbashi','mbujimayi','goma','bukavu'],
true,82),

('ln','Naza wapi nakozwa colis na ngai?','Tokomemela yo na adresse na yo na Kinshasa. Liboso ya Kinshasa te (Lubumbashi, Mbujimayi, Goma, Bukavu...), tosalaka na partenaire ya transport. Soki colis ekomi na RDC, équipe na biso ekobenga yo mpo na ko-confirmer esika ya koza pene na yo.',
ARRAY['pickup','agence','ln'],
ARRAY['agence','wapi nakozwa','wapi colis','point de retrait','lubumbashi','mbujimayi','goma'],
true,82),

-- Wrong item received
('fr','Et si l''article reçu n''est pas le bon ?','Si l''article livré ne correspond pas à votre commande, contactez-nous dans les 48h avec une photo. Nous prenons en charge l''échange ou le remboursement complet — c''est notre responsabilité, pas la vôtre. ✅',
ARRAY['wrong_item','litige','garantie','échange'],
ARRAY['pas le même','pas le bon','article différent','wrong item','n''est pas le bon','ce n''est pas','autre article','mauvais article','je reçois pas'],
true,80),

('en','What if the item I receive is not the right one?','If the delivered item does not match your order, contact us within 48h with a photo. We cover the exchange or a full refund — it''s on us, not on you. ✅',
ARRAY['wrong_item','dispute','warranty','exchange'],
ARRAY['wrong item','not the same','different item','not what i ordered','not the right one','wrong product'],
true,80),

('ln','Soki article ekokani te na oyo na commandé?','Soki article oyo bapesi yo ekokani te na commande na yo, benga biso na 48 heures na photo. Tokosala échange to remboursement complet — ezali responsabilité na biso. ✅',
ARRAY['wrong_item','ln'],
ARRAY['ekokani te','article mosusu','ezali ya solo te','mauvais article'],
true,80),

-- Cash only / espèce
('fr','Je préfère payer en espèces / cash','Le paiement se fait en ligne par Mobile Money (Airtel Money, M-Pesa, Orange Money) ou carte bancaire (Visa/Mastercard). Pour faciliter, vous pouvez aussi payer **30% maintenant + 70% à la livraison** — le solde de 70% peut être réglé en cash au livreur. 👍',
ARRAY['cash','espèce','paiement','30_70'],
ARRAY['en espèce','en especes','espèces','cash','liquide','je préfère en espèce','payer cash','no card','sans carte','pas de mobile money'],
true,85),

('en','I prefer to pay in cash','Payment is online via Mobile Money (Airtel Money, M-Pesa, Orange Money) or bank card (Visa/Mastercard). To make it easier, you can also pay **30% now + 70% on delivery** — the 70% balance can be paid in cash to the courier. 👍',
ARRAY['cash','payment','30_70'],
ARRAY['in cash','pay cash','cash only','no card','i prefer cash','prefer cash'],
true,85),

('ln','Nalingi kofuta na mbongo ya makasi (cash)','Paiement esalaka en ligne na Mobile Money to carte. Mpo na kosalisa yo, okoki pe kofuta **30% sikoyo + 70% na livraison** — 70% okoki kofuta yango cash epai ya livreur. 👍',
ARRAY['cash','ln'],
ARRAY['mbongo ya makasi','cash','liquide','nalingi cash'],
true,85),

-- Product images
('fr','Pouvez-vous m''envoyer les images du produit ?','Toutes les photos du produit sont visibles directement sur la page du produit dans l''app/site — cliquez sur le produit pour voir toutes les images en grand. Si vous regardez un produit précis, dites-moi le nom et je vous donne le lien direct. 📸',
ARRAY['images','photos','product_images'],
ARRAY['envoie-moi les images','envoyez les images','images du produit','photos du produit','m''envoyer les images','send me pictures','plus de photos','voir les photos'],
true,75),

('en','Can you send me product images?','All product photos are right on the product page in the app/site — tap the product to see every image in full size. Tell me which product you''re looking at and I''ll share the direct link. 📸',
ARRAY['images','photos'],
ARRAY['send me images','send pictures','more pictures','product photos','show pictures','show me pictures'],
true,75),

('ln','Okoki kotindela ngai bafoto ya produit?','Bafoto nyonso ya produit ezali na page ya produit na app/site — finá produit mpo na komona bafoto nyonso. Yebisa ngai produit nini, nakopesa yo lien. 📸',
ARRAY['photos','ln'],
ARRAY['bafoto','images','photos','tindela ngai photo'],
true,75),

-- Discount "ya pas / pas moyen"
('fr','Ya pas de réduction ? Pas moyen ?','Nos prix sont déjà tout compris (produit + livraison RDC + taxes + frais) et au plus bas — il n''y a pas de réduction supplémentaire. Mais vous pouvez payer en 2 fois : **30% maintenant + 70% à la livraison**. 👍',
ARRAY['discount','réduction','négociation'],
ARRAY['ya pas de','y''a pas de','y a pas de','pas moyen','aucune réduction','aucun rabais','pas de rabais','rien à faire sur le prix','pas de remise'],
true,88),

('en','Any way to lower the price? No discount?','Our prices are already all-inclusive (product + delivery to DRC + taxes + fees) and as low as we can go — no extra discount. But you can split the payment: **30% now + 70% on delivery**. 👍',
ARRAY['discount','negotiation'],
ARRAY['no way','any discount','no discount','lower the price','any deal','any way to'],
true,88),

-- Human-agent request (Sophie offers to help first)
('fr','Je veux parler à un humain / un agent','Je suis Sophie, l''assistante AfriShop — je peux répondre directement à la plupart des questions (prix, livraison, paiement 30/70, produits, suivi). Posez-moi votre question, et si je ne peux vraiment pas vous aider, je vous mets aussitôt en contact avec l''équipe. 🙂',
ARRAY['human','agent','support'],
ARRAY['un humain','parler à un agent','vrai agent','contact humain','customer service','je veux un humain','agent svp'],
true,60),

('en','I want to talk to a human / agent','I''m Sophie, the AfriShop assistant — I can answer most questions directly (price, delivery, 30/70 payment, products, order status). Ask me your question first, and if I really can''t help I''ll connect you with the team right away. 🙂',
ARRAY['human','agent','support'],
ARRAY['talk to a human','real agent','human agent','speak to someone','customer service','want an agent'],
true,60),

('ln','Nalingi koloba na moto ya solo / agent','Nazali Sophie, assistante ya AfriShop — nakoki kopesa yo réponse na mituna mingi (prix, livraison, paiement 30/70, produits). Tuna ngai liboso, soki nakoki kosalisa yo te, nakomema yo na équipe. 🙂',
ARRAY['human','agent','ln'],
ARRAY['moto ya solo','agent','vrai agent','support'],
true,60);
