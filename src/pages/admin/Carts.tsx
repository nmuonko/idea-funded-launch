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

export default function AdminCarts() {
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCart, setSelectedCart] = useState<Cart | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { permissions } = useAdminPermissions();

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
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-8 w-8" />
            Active Carts & Non-finalized Orders
          </h1>
          <p className="text-muted-foreground">View customer carts that haven't been finalized yet</p>
        </div>
        {permissions?.isSuperAdmin && (
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => setResetDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Reset Carts
          </Button>
        )}
      </div>

      <ResetSectionDialog
        section="carts"
        sectionLabel="Active Carts"
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onSuccess={loadCarts}
      />

      <Card>
        <CardHeader>
          <CardTitle>Active Carts ({carts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading carts...</div>
          ) : carts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No active carts found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total (USD)</TableHead>
                  <TableHead>Total (CDF)</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
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
                        View Details
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
            <DialogTitle>Cart Details - {selectedCart?.userName}</DialogTitle>
          </DialogHeader>

          {selectedCart && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div>{getStatusBadge(selectedCart.status)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div>{format(new Date(selectedCart.createdAt), 'MMM dd, yyyy HH:mm')}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Last Updated</div>
                  <div>{format(new Date(selectedCart.updatedAt), 'MMM dd, yyyy HH:mm')}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Phone</div>
                  <div>{selectedCart.userPhone || 'N/A'}</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">Cart Items ({selectedCart.items.length})</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Product Link</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Subtotal</TableHead>
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
                              View Product
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
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>${selectedCart.subtotalUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shipping Fee:</span>
                    <span>${selectedCart.shippingFeeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service Fee:</span>
                    <span>${selectedCart.serviceFeeUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-2 border-t">
                    <span>Total:</span>
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
