import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExternalLink, ShoppingCart, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
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

type SortField = 'updated_at' | 'total_usd' | 'item_count' | 'created_at';
type SortOrder = 'asc' | 'desc';

export default function ActiveCartsContent() {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCart, setSelectedCart] = useState<Cart | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { permissions } = useAdminPermissions();
  const { language } = useLanguage();

  // Sort and filter state
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCarts();
  }, [sortField, sortOrder, statusFilter]);

  const loadCarts = async () => {
    try {
      setLoading(true);
      
      // Build query params
      const params = new URLSearchParams();
      params.set('sortBy', sortField);
      params.set('sortOrder', sortOrder);
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      
      const { data, error } = await supabase.functions.invoke('admin-get-carts', {
        body: null,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Since we can't easily pass query params to invoke, we'll filter/sort client-side
      // for now (the backend also supports it)
      if (error) throw error;

      let cartsData = data.carts || [];
      
      // Apply client-side sorting since supabase.functions.invoke doesn't support query params well
      cartsData.sort((a: Cart, b: Cart) => {
        let aVal: number | string;
        let bVal: number | string;
        
        switch (sortField) {
          case 'total_usd':
            aVal = a.totalUsd;
            bVal = b.totalUsd;
            break;
          case 'item_count':
            aVal = a.itemCount;
            bVal = b.itemCount;
            break;
          case 'created_at':
            aVal = a.createdAt;
            bVal = b.createdAt;
            break;
          default:
            aVal = a.updatedAt;
            bVal = b.updatedAt;
        }
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortOrder === 'asc' 
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
      
      // Apply status filter
      if (statusFilter !== 'all') {
        cartsData = cartsData.filter((cart: Cart) => cart.status === statusFilter);
      }

      setCarts(cartsData);
    } catch (error) {
      console.error('Error loading carts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortOrder === 'asc' 
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const filteredCarts = carts.filter(cart => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return cart.userName.toLowerCase().includes(query) || 
           cart.userPhone.includes(query) ||
           cart.cartId.toLowerCase().includes(query);
  });

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
    searchPlaceholder: language === 'fr' ? 'Rechercher par nom ou téléphone...' : 'Search by name or phone...',
    allStatuses: language === 'fr' ? 'Tous les statuts' : 'All Statuses',
    draft: language === 'fr' ? 'Brouillon' : 'Draft',
    pendingPayment: language === 'fr' ? 'Paiement en attente' : 'Pending Payment',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={cartsText.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder={cartsText.allStatuses} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{cartsText.allStatuses}</SelectItem>
              <SelectItem value="DRAFT">{cartsText.draft}</SelectItem>
              <SelectItem value="PENDING_PAYMENT">{cartsText.pendingPayment}</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
          <CardTitle>{cartsText.activeCarts} ({filteredCarts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">{cartsText.loading}</div>
          ) : filteredCarts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{cartsText.noActiveCarts}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{cartsText.user}</TableHead>
                  <TableHead>{cartsText.status}</TableHead>
                  <TableHead>
                    <button 
                      onClick={() => handleSort('item_count')}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      {cartsText.items}
                      {getSortIcon('item_count')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button 
                      onClick={() => handleSort('total_usd')}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      {cartsText.totalUsd}
                      {getSortIcon('total_usd')}
                    </button>
                  </TableHead>
                  <TableHead>{cartsText.totalCdf}</TableHead>
                  <TableHead>
                    <button 
                      onClick={() => handleSort('updated_at')}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      {cartsText.lastUpdated}
                      {getSortIcon('updated_at')}
                    </button>
                  </TableHead>
                  <TableHead>{cartsText.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCarts.map((cart) => (
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
