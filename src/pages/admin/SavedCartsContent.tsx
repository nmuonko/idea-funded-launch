import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Bookmark, ExternalLink, Bell, Clock, User, ShoppingBag, Trash2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { ResetSectionDialog } from '@/components/admin/ResetSectionDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

interface SavedCartUser {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  savedItemCount: number;
  earliestSavedAt: string | null;
  latestSavedAt: string | null;
  lastReminderAt: string | null;
  totalValue: number;
  items: SavedItem[];
}

interface SavedItem {
  id: string;
  productUrl: string;
  title: string | null;
  store: string;
  basePriceUsd: number;
  quantity: number;
  savedAt: string | null;
  lastReminderAt: string | null;
}

export default function SavedCartsContent() {
  const [savedCarts, setSavedCarts] = useState<SavedCartUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<SavedCartUser | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { toast } = useToast();
  const { permissions } = useAdminPermissions();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    loadSavedCarts();
  }, []);

  const loadSavedCarts = async () => {
    try {
      setLoading(true);

      const { data: items, error } = await supabase
        .from('order_items')
        .select(`
          id,
          product_url,
          title,
          store,
          base_price_usd,
          quantity,
          saved_at,
          last_reminder_at,
          orders!inner(
            id,
            user_id,
            status
          )
        `)
        .eq('is_saved_for_later', true)
        .eq('orders.status', 'DRAFT')
        .order('saved_at', { ascending: false });

      if (error) throw error;

      const userIds = [...new Set(items?.map(i => (i.orders as any).user_id) || [])];
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const userMap = new Map<string, SavedCartUser>();
      
      (items || []).forEach(item => {
        const userId = (item.orders as any).user_id;
        const profile = profileMap.get(userId);
        
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName: profile?.full_name || profile?.name || null,
            userEmail: null,
            savedItemCount: 0,
            earliestSavedAt: null,
            latestSavedAt: null,
            lastReminderAt: null,
            totalValue: 0,
            items: [],
          });
        }

        const user = userMap.get(userId)!;
        user.savedItemCount += item.quantity || 1;
        user.totalValue += (Number(item.base_price_usd) || 0) * (item.quantity || 1);
        
        if (item.saved_at) {
          if (!user.earliestSavedAt || new Date(item.saved_at) < new Date(user.earliestSavedAt)) {
            user.earliestSavedAt = item.saved_at;
          }
          if (!user.latestSavedAt || new Date(item.saved_at) > new Date(user.latestSavedAt)) {
            user.latestSavedAt = item.saved_at;
          }
        }
        
        if (item.last_reminder_at) {
          if (!user.lastReminderAt || new Date(item.last_reminder_at) > new Date(user.lastReminderAt)) {
            user.lastReminderAt = item.last_reminder_at;
          }
        }

        user.items.push({
          id: item.id,
          productUrl: item.product_url,
          title: item.title,
          store: item.store,
          basePriceUsd: Number(item.base_price_usd) || 0,
          quantity: item.quantity || 1,
          savedAt: item.saved_at,
          lastReminderAt: item.last_reminder_at,
        });
      });

      setSavedCarts(Array.from(userMap.values()));
    } catch (error: any) {
      toast({
        title: 'Error loading saved carts',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const triggerReminders = async () => {
    try {
      toast({ title: t.savedCarts.sendingReminders, description: t.savedCarts.mayTakeMoment });
      
      const { data, error } = await supabase.functions.invoke('saved-cart-reminders');
      
      if (error) throw error;
      
      const emailCount = data.emailsSent || 0;
      const pushCount = data.pushSent || 0;
      const errorCount = data.errors || 0;
      
      toast({
        title: t.savedCarts.remindersSent,
        description: `${t.savedCarts.sentEmails.replace('{count}', emailCount.toString())} ${t.savedCarts.sentPush.replace('{count}', pushCount.toString())}${errorCount > 0 ? ` ${errorCount} ${t.common.failed}.` : ''}`,
      });
      
      loadSavedCarts();
    } catch (error: any) {
      toast({
        title: t.savedCarts.errorSendingReminders,
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const filteredCarts = savedCarts.filter(cart => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      cart.userName?.toLowerCase().includes(query) ||
      cart.userId.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button onClick={triggerReminders}>
          <Bell className="h-4 w-4 mr-2" />
          {t.savedCarts.sendReminders}
        </Button>
        {permissions?.isSuperAdmin && (
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => setResetDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t.common.reset}
          </Button>
        )}
      </div>

      <ResetSectionDialog
        section="carts"
        sectionLabel={t.savedCarts.title}
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onSuccess={loadSavedCarts}
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.savedCarts.usersWithSavedItems}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{savedCarts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.savedCarts.totalSavedItems}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {savedCarts.reduce((sum, c) => sum + c.savedItemCount, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.savedCarts.totalValue}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${savedCarts.reduce((sum, c) => sum + c.totalValue, 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.savedCarts.avgItemsPerUser}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {savedCarts.length > 0 
                ? (savedCarts.reduce((sum, c) => sum + c.savedItemCount, 0) / savedCarts.length).toFixed(1)
                : '0'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t.savedCarts.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredCarts.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              {t.savedCarts.noSavedCarts}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.common.user}</TableHead>
                  <TableHead className="text-center">{t.common.items}</TableHead>
                  <TableHead className="text-right">{t.common.value}</TableHead>
                  <TableHead>{t.savedCarts.savedSince}</TableHead>
                  <TableHead>{t.savedCarts.lastReminder}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCarts.map((cart) => (
                  <TableRow key={cart.userId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{cart.userName || 'Unknown User'}</p>
                          <p className="text-xs text-muted-foreground">{cart.userId.slice(0, 8)}...</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{cart.savedItemCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${cart.totalValue.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {cart.earliestSavedAt ? (
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(cart.earliestSavedAt), { addSuffix: true })}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {cart.lastReminderAt ? (
                        <Badge variant="outline" className="text-xs">
                          {format(new Date(cart.lastReminderAt), 'MMM dd')}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">{t.common.never}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedUser(cart)}
                      >
                        <ShoppingBag className="h-4 w-4 mr-1" />
                        {t.savedCarts.viewItems}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Item Details Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="h-5 w-5" />
              {t.savedCarts.savedItems} - {selectedUser?.userName || t.common.unknownUser}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {selectedUser?.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.store}</Badge>
                    <p className="font-medium">{item.title || t.common.product}</p>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span>${item.basePriceUsd.toFixed(2)} × {item.quantity}</span>
                    {item.savedAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t.savedCarts.saved} {formatDistanceToNow(new Date(item.savedAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-green-600">
                    ${(item.basePriceUsd * item.quantity).toFixed(2)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                  >
                    <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-muted-foreground">
              {selectedUser?.savedItemCount} {t.savedCarts.itemsSaved}
            </span>
            <span className="text-lg font-bold">
              {t.common.total}: ${selectedUser?.totalValue.toFixed(2)}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
