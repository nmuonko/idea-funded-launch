import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ExternalLink, ShoppingCart, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { ResetSectionDialog } from '@/components/admin/ResetSectionDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { getStatusTranslation } from '@/lib/i18n/translations';

interface CartItem {
  id: string;
  productTitle: string;
  productUrl: string;
  productImageUrl: string | null;
  store: string;
  basePriceUsd: number;
  markupFeeUsd: number;
  shippingFeeUsd: number;
  totalPriceUsd: number;
  totalPriceCdf: number;
  quantity: number;
}

interface Cart {
  cartId: string;
  userId: string;
  userName: string;
  userPhone: string;
  status: string;
  itemCount: number;
  subtotalUsd: number;
  shippingFeeUsd: number;
  serviceFeeUsd: number;
  totalUsd: number;
  totalCdf: number;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}

export default function ActiveCartsContent() {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCart, setSelectedCart] = useState<Cart | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { permissions } = useAdminPermissions();
  const { language } = useLanguage();

  useEffect(() => {
    loadCarts();
  }, []);

  const loadCarts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('admin-get-carts');

      if (error) throw error;

      setCarts(data.carts || []);
    } catch (error) {
      console.error('Error loading carts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
      DRAFT: 'secondary',
      PENDING_PAYMENT: 'outline',
    };
    return <Badge variant={variants[status] || 'default'}>{getStatusTranslation(status, language)}</Badge>;
  };

  const cartsText = {
    activeCarts: language === 'fr' ? 'Paniers actifs' : 'Active Carts',
    noActiveCarts: language === 'fr' ? 'Aucun panier actif trouvé' : 'No active carts found',
    cartDetails: language === 'fr' ? 'Détails du panier' : 'Cart Details',
    cartItems: language === 'fr' ? 'Articles du panier' : 'Cart Items',
    resetCarts: language === 'fr' ? 'Réinitialiser' : 'Reset',
    loading: language === 'fr' ? 'Chargement...' : 'Loading carts...',
    user: language === 'fr' ? 'Utilisateur' : 'User',
    status: language === 'fr' ? 'Statut' : 'Status',
    items: language === 'fr' ? 'Articles' : 'Items',
    totalUsd: language === 'fr' ? 'Total (USD)' : 'Total (USD)',
    totalCdf: language === 'fr' ? 'Total (CDF)' : 'Total (CDF)',
    lastUpdated: language === 'fr' ? 'Dernière mise à jour' : 'Last Updated',
    actions: language === 'fr' ? 'Actions' : 'Actions',
    viewDetails: language === 'fr' ? 'Voir détails' : 'View Details',
    created: language === 'fr' ? 'Créé' : 'Created',
    phone: language === 'fr' ? 'Téléphone' : 'Phone',
    product: language === 'fr' ? 'Produit' : 'Product',
    productLink: language === 'fr' ? 'Lien produit' : 'Product Link',
    store: language === 'fr' ? 'Boutique' : 'Store',
    qty: language === 'fr' ? 'Qté' : 'Qty',
    unitPrice: language === 'fr' ? 'Prix unitaire' : 'Unit Price',
    subtotal: language === 'fr' ? 'Sous-total' : 'Subtotal',
    viewProduct: language === 'fr' ? 'Voir produit' : 'View Product',
    shippingFee: language === 'fr' ? 'Frais de livraison' : 'Shipping Fee',
    serviceFee: language === 'fr' ? 'Frais de service' : 'Service Fee',
    total: language === 'fr' ? 'Total' : 'Total',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {permissions?.isSuperAdmin && (
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => setResetDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {cartsText.resetCarts}
          </Button>
        )}
      </div>

      <ResetSectionDialog
        section="carts"
        sectionLabel={cartsText.activeCarts}
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onSuccess={loadCarts}
      />

      <Card>
        <CardHeader>
          <CardTitle>{cartsText.activeCarts} ({carts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">{cartsText.loading}</div>
          ) : carts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{cartsText.noActiveCarts}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{cartsText.user}</TableHead>
                  <TableHead>{cartsText.status}</TableHead>
                  <TableHead>{cartsText.items}</TableHead>
                  <TableHead>{cartsText.totalUsd}</TableHead>
                  <TableHead>{cartsText.totalCdf}</TableHead>
                  <TableHead>{cartsText.lastUpdated}</TableHead>
                  <TableHead>{cartsText.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carts.map((cart) => (
                  <TableRow key={cart.cartId}>
                    <TableCell>
                      <div className="font-medium">{cart.userName}</div>
                      {cart.userPhone && (
                        <div className="text-sm text-muted-foreground">{cart.userPhone}</div>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(cart.status)}</TableCell>
                    <TableCell>{cart.itemCount}</TableCell>
                    <TableCell>${cart.totalUsd.toFixed(2)}</TableCell>
                    <TableCell>{cart.totalCdf.toFixed(0)} FC</TableCell>
                    <TableCell>{format(new Date(cart.updatedAt), 'MMM dd, yyyy HH:mm')}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedCart(cart)}
                      >
                        {cartsText.viewDetails}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedCart} onOpenChange={(open) => !open && setSelectedCart(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{cartsText.cartDetails} - {selectedCart?.userName}</DialogTitle>
          </DialogHeader>

          {selectedCart && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">{cartsText.status}</div>
                  <div>{getStatusBadge(selectedCart.status)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{cartsText.created}</div>
                  <div>{format(new Date(selectedCart.createdAt), 'MMM dd, yyyy HH:mm')}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{cartsText.lastUpdated}</div>
                  <div>{format(new Date(selectedCart.updatedAt), 'MMM dd, yyyy HH:mm')}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">{cartsText.phone}</div>
                  <div>{selectedCart.userPhone || 'N/A'}</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">{cartsText.cartItems} ({selectedCart.items.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{cartsText.product}</TableHead>
                      <TableHead>{cartsText.productLink}</TableHead>
                      <TableHead>{cartsText.store}</TableHead>
                      <TableHead>{cartsText.qty}</TableHead>
                      <TableHead>{cartsText.unitPrice}</TableHead>
                      <TableHead>{cartsText.subtotal}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCart.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.productImageUrl && (
                              <img
                                src={item.productImageUrl}
                                alt={item.productTitle}
                                className="w-12 h-12 object-cover rounded"
                              />
                            )}
                            <div className="max-w-xs truncate">{item.productTitle}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.productUrl ? (
                            <a
                              href={item.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              {cartsText.viewProduct}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.store}</Badge>
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>${item.basePriceUsd.toFixed(2)}</TableCell>
                        <TableCell>${item.totalPriceUsd.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{cartsText.subtotal}:</span>
                    <span>${selectedCart.subtotalUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{cartsText.shippingFee}:</span>
                    <span>${selectedCart.shippingFeeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{cartsText.serviceFee}:</span>
                    <span>${selectedCart.serviceFeeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-2 border-t">
                    <span>{cartsText.total}:</span>
                    <div className="text-right">
                      <div>${selectedCart.totalUsd.toFixed(2)}</div>
                      <div className="text-sm text-muted-foreground">{selectedCart.totalCdf.toFixed(0)} FC</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
