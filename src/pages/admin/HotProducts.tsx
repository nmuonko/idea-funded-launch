import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Plus, Trash2, Send, Save, Eye, Loader2, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface SelectedProduct {
  id: string;
  title: string;
  image_url: string;
  price_usd: number;
  total_price_usd: number;
  product_url: string;
  provider: string;
  provider_product_id: string;
}

interface Campaign {
  id: string;
  title: string;
  status: string;
  products: SelectedProduct[];
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
}

export default function HotProducts() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    setLoading(true);
    const { data, error } = await supabase
      .from('hot_product_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error && data) {
      setCampaigns(data.map(c => ({
        ...c,
        products: (c.products as any) || [],
      })));
    }
    setLoading(false);
  }

  async function searchProducts() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const { data, error } = await supabase
      .from('catalog_items')
      .select('id, title, image_url, price_usd, provider, provider_product_id')
      .ilike('title', `%${searchQuery}%`)
      .eq('is_active', true)
      .limit(20);
    if (!error && data) {
      setSearchResults(data);
    }
    setSearching(false);
  }

  function addProduct(item: any) {
    if (selectedProducts.length >= 3) {
      toast.error('Maximum 3 products per campaign');
      return;
    }
    if (selectedProducts.find(p => p.id === item.id)) {
      toast.error('Product already added');
      return;
    }
    setSelectedProducts(prev => [...prev, {
      id: item.id,
      title: item.title || 'Untitled',
      image_url: item.image_url || '',
      price_usd: item.price_usd || 0,
      total_price_usd: item.price_usd || 0,
      product_url: `https://afrishop-usa.com/product/${item.provider}/${item.provider_product_id}`,
      provider: item.provider || '',
      provider_product_id: item.provider_product_id || '',
    }]);
  }

  function removeProduct(id: string) {
    setSelectedProducts(prev => prev.filter(p => p.id !== id));
  }

  function updateTotalPrice(id: string, price: number) {
    setSelectedProducts(prev => prev.map(p => p.id === id ? { ...p, total_price_usd: price } : p));
  }

  async function saveDraft() {
    if (!campaignTitle.trim()) {
      toast.error('Please enter a campaign title');
      return;
    }
    if (selectedProducts.length === 0) {
      toast.error('Select at least 1 product');
      return;
    }
    setSaving(true);
    const payload = {
      title: campaignTitle,
      status: 'draft',
      products: selectedProducts as any,
      created_by: user?.id,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingCampaignId) {
      ({ error } = await supabase.from('hot_product_campaigns').update(payload).eq('id', editingCampaignId));
    } else {
      ({ error } = await supabase.from('hot_product_campaigns').insert(payload));
    }

    if (error) {
      toast.error('Failed to save: ' + error.message);
    } else {
      toast.success('Draft saved');
      resetForm();
      loadCampaigns();
    }
    setSaving(false);
  }

  async function approveAndSend(campaignId: string) {
    setSending(true);
    // Update status to approved
    const { error: updateErr } = await supabase
      .from('hot_product_campaigns')
      .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq('id', campaignId);
    if (updateErr) {
      toast.error('Failed to approve');
      setSending(false);
      return;
    }

    // Trigger edge function
    const { data, error } = await supabase.functions.invoke('send-hot-products-email', {
      body: { campaignId },
    });
    if (error) {
      toast.error('Failed to send: ' + error.message);
    } else {
      toast.success(`Campaign sent! ${(data as any)?.sent || 0} emails delivered.`);
    }
    loadCampaigns();
    setSending(false);
  }

  function editCampaign(c: Campaign) {
    setEditingCampaignId(c.id);
    setCampaignTitle(c.title);
    setSelectedProducts(c.products);
  }

  function resetForm() {
    setEditingCampaignId(null);
    setCampaignTitle('');
    setSelectedProducts([]);
    setSearchQuery('');
    setSearchResults([]);
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-blue-100 text-blue-800',
    sending: 'bg-orange-100 text-orange-800',
    sent: 'bg-green-100 text-green-800',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{language === 'fr' ? 'Produits Vedettes' : 'Hot Products'}</h1>
          <p className="text-sm text-muted-foreground">
            {language === 'fr' ? 'Créez des campagnes email avec les produits phares' : 'Create email campaigns with featured products'}
          </p>
        </div>
      </div>

      {/* Campaign Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {editingCampaignId ? (language === 'fr' ? 'Modifier Campagne' : 'Edit Campaign') : (language === 'fr' ? 'Nouvelle Campagne' : 'New Campaign')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder={language === 'fr' ? 'Titre de la campagne (ex: Semaine du 12 mars)' : 'Campaign title (e.g. Week of March 12)'}
            value={campaignTitle}
            onChange={e => setCampaignTitle(e.target.value)}
          />

          {/* Product Search */}
          <div className="flex gap-2">
            <Input
              placeholder={language === 'fr' ? 'Rechercher des produits...' : 'Search products...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchProducts()}
            />
            <Button onClick={searchProducts} disabled={searching} size="sm">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
              {searchResults.map(item => (
                <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer" onClick={() => addProduct(item)}>
                  {item.image_url && <img src={item.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground">${item.price_usd?.toFixed(2) || '0.00'}</p>
                  </div>
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                </div>
              ))}
            </div>
          )}

          {/* Selected Products */}
          {selectedProducts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{language === 'fr' ? 'Produits sélectionnés' : 'Selected Products'} ({selectedProducts.length}/3)</p>
              {selectedProducts.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  {p.image_url && <img src={p.image_url} alt="" className="w-14 h-14 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Prix de base' : 'Base price'}: ${p.price_usd.toFixed(2)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <label className="text-xs font-medium">{language === 'fr' ? 'Prix total (livraison incluse)' : 'Total price (incl. shipping)'}:</label>
                      <Input
                        type="number"
                        className="h-7 w-28 text-sm"
                        value={p.total_price_usd}
                        onChange={e => updateTotalPrice(p.id, parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeProduct(p.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={saveDraft} disabled={saving} variant="outline">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {language === 'fr' ? 'Enregistrer brouillon' : 'Save Draft'}
            </Button>
            {selectedProducts.length > 0 && (
              <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Eye className="h-4 w-4 mr-2" />
                    {language === 'fr' ? 'Aperçu' : 'Preview'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{language === 'fr' ? 'Aperçu Email' : 'Email Preview'}</DialogTitle>
                  </DialogHeader>
                  <div
                    className="border rounded-lg p-4"
                    dangerouslySetInnerHTML={{ __html: buildPreviewHtml(selectedProducts) }}
                  />
                </DialogContent>
              </Dialog>
            )}
            {editingCampaignId && (
              <Button variant="ghost" onClick={resetForm}>
                {language === 'fr' ? 'Annuler' : 'Cancel'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Campaign History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{language === 'fr' ? 'Historique des campagnes' : 'Campaign History'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{language === 'fr' ? 'Aucune campagne' : 'No campaigns yet'}</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{c.title || 'Untitled'}</p>
                      <Badge className={statusColor[c.status] || ''}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.products.length} {language === 'fr' ? 'produits' : 'products'}
                      {c.status === 'sent' && ` • ${c.sent_count} sent, ${c.failed_count} failed`}
                      {' • '}{new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {c.status === 'draft' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => editCampaign(c)}>
                          {language === 'fr' ? 'Modifier' : 'Edit'}
                        </Button>
                        <Button size="sm" onClick={() => approveAndSend(c.id)} disabled={sending}>
                          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                          {language === 'fr' ? 'Approuver & Envoyer' : 'Approve & Send'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function buildPreviewHtml(products: SelectedProduct[]): string {
  const productCards = products.map(p => `
    <div style="text-align:center;margin-bottom:20px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-width:280px;display:inline-block;vertical-align:top;margin:8px;">
      ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%;height:200px;object-fit:cover;" />` : '<div style="width:100%;height:200px;background:#f3f4f6;"></div>'}
      <div style="padding:12px;">
        <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;color:#1a1a1a;">${p.title}</p>
        <p style="font-size:20px;font-weight:700;color:#e63946;margin:4px 0;">$${p.total_price_usd.toFixed(2)}</p>
        <p style="font-size:11px;color:#888;margin:0 0 8px 0;">Livraison incluse / Shipping included</p>
        <a href="${p.product_url}" style="display:inline-block;background:#e63946;color:#fff;padding:8px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Acheter / Buy Now</a>
      </div>
    </div>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
      <div style="text-align:center;padding:20px;background:#1a1a1a;">
        <h1 style="color:#fff;font-size:22px;margin:0;">🛍️ AfriShop USA</h1>
      </div>
      <div style="padding:24px;">
        <h2 style="text-align:center;color:#1a1a1a;font-size:18px;">🇫🇷 Produits Vedettes de la Semaine</h2>
        <p style="text-align:center;color:#555;font-size:13px;">Découvrez nos meilleurs produits sélectionnés pour vous, livrés jusqu'en RDC !</p>
        <div style="text-align:center;">${productCards}</div>
        
        <div style="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #e63946;">
          <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;">🔗 Vous ne trouvez pas ce que vous cherchez ?</p>
          <p style="font-size:12px;color:#555;margin:0 0 8px 0;">Allez sur notre page "Paste Any Link", choisissez un magasin et collez le lien du produit pour obtenir le prix total avec livraison.</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background:#1a1a1a;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">Coller un lien →</a>
        </div>

        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />

        <h2 style="text-align:center;color:#1a1a1a;font-size:18px;">🇬🇧 Hot Products This Week</h2>
        <p style="text-align:center;color:#555;font-size:13px;">Check out our top picks, delivered to DRC!</p>
        <div style="text-align:center;">${productCards}</div>

        <div style="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #e63946;">
          <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;">🔗 Can't find what you're looking for?</p>
          <p style="font-size:12px;color:#555;margin:0 0 8px 0;">Go to our "Paste Any Link" page, choose any store from the list, and paste the product link to get the full price including shipping.</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background:#1a1a1a;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">Paste a Link →</a>
        </div>
      </div>
      <div style="text-align:center;padding:16px;background:#f3f4f6;font-size:11px;color:#888;">
        <p>AfriShop USA — Shop from anywhere, delivered to Africa</p>
        <p>© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
      </div>
    </div>
  `;
}
