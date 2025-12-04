import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Eye, Download, CheckCircle, FileText, Search, Mail, CalendarIcon, X } from 'lucide-react';
import { OrderDetailsDrawer } from '@/components/admin/OrderDetailsDrawer';
import { SendOrderEmailDialog } from '@/components/admin/SendOrderEmailDialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function AdminOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'finalized' | 'non-finalized'>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Filter orders based on search query and date range
  const filteredOrders = useMemo(() => {
    let result = orders;
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(order => {
      const customerName = (order.profiles?.name || order.profiles?.full_name || '').toLowerCase();
        const customerPhone = order.profiles?.phone?.toLowerCase() || '';
        const orderId = order.id.toLowerCase();
        
        return customerName.includes(query) || 
               customerPhone.includes(query) || 
               orderId.includes(query);
      });
    }
    
    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter(order => new Date(order.created_at) >= fromDate);
    }
    
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter(order => new Date(order.created_at) <= toDate);
    }
    
    return result;
  }, [orders, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    loadOrders();
  }, [statusFilter, orderTypeFilter]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('orders')
        .select(`
          *,
          profiles(user_id, name, full_name, phone),
          order_items(id, title, product_url, product_image_url, quantity)
        `)
        .order('created_at', { ascending: false });

      // Apply order type filter
      if (orderTypeFilter === 'finalized') {
        query = query.in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED']);
      } else if (orderTypeFilter === 'non-finalized') {
        query = query.in('status', ['DRAFT', 'PENDING_PAYMENT']);
      }

      // Apply specific status filter
      if (statusFilter !== 'ALL') {
        query = query.eq('status', statusFilter as any);
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'secondary',
      PENDING_PAYMENT: 'default',
      PAID: 'default',
      PROCESSING: 'default',
      SHIPPED: 'default',
      READY_FOR_PICKUP: 'default',
      COMPLETED: 'default',
      CANCELLED: 'destructive',
    };
    return <Badge variant={colors[status] as any}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const getPaymentBadge = (order: any) => {
    if (order.payment_verified_at) {
      return <Badge className="bg-emerald-600">Verified</Badge>;
    }
    if (order.status === 'DRAFT') {
      return <Badge variant="secondary">Draft</Badge>;
    }
    return <Badge variant="outline">Pending</Badge>;
  };

  const openOrderDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
    setDrawerOpen(true);
  };

  const closeOrderDetails = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedOrderId(null), 300);
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const toggleSelectOrder = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedOrders.size === 0) return;
    
    try {
      setBulkActionLoading(true);
      const orderIds = Array.from(selectedOrders);
      
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus as any })
        .in('id', orderIds);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Updated ${orderIds.length} order(s) to ${newStatus}`,
      });

      setSelectedOrders(new Set());
      loadOrders();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkVerifyPayment = async () => {
    if (selectedOrders.size === 0) return;
    
    try {
      setBulkActionLoading(true);
      const orderIds = Array.from(selectedOrders);
      
      const { error } = await supabase
        .from('orders')
        .update({ 
          payment_verified_at: new Date().toISOString(),
          payment_verification_method: 'BULK_ADMIN_VERIFICATION',
          status: 'PAID'
        })
        .in('id', orderIds);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Verified payment for ${orderIds.length} order(s)`,
      });

      setSelectedOrders(new Set());
      loadOrders();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkExport = () => {
    if (selectedOrders.size === 0) return;

    const selectedOrdersData = orders.filter(o => selectedOrders.has(o.id));
    const headers = [
      'Order ID',
      'Customer Name',
      'Customer Email',
      'Phone',
      'Shipping City',
      'Status',
      'Payment Status',
      'Payment Verified',
      'Item Total USD',
      'Service Fee USD',
      'Shipping Fee USD',
      'Total USD',
      'Total CDF',
      'Exchange Rate',
      'Tracking Number',
      'Carrier',
      'Items Count',
      'Item Titles',
      'Created At',
      'Updated At',
      'Shipped At',
      'Delivered At',
      'Admin Notes'
    ];
    
    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    const rows = selectedOrdersData.map(order => [
      order.id,
      order.profiles?.name || order.profiles?.full_name || '',
      '',
      order.profiles?.phone || '',
      order.shipping_city || '',
      order.status,
      order.maisha_payment_status || '',
      order.payment_verified_at ? 'Yes' : 'No',
      Number(order.item_total_usd || 0).toFixed(2),
      Number(order.service_fee_usd || 0).toFixed(2),
      Number(order.shipping_fee_usd || 0).toFixed(2),
      Number(order.total_usd || 0).toFixed(2),
      Number(order.total_cdf || 0).toFixed(2),
      order.exchange_rate_used || '',
      order.tracking_number || '',
      order.carrier || '',
      order.order_items?.length || 0,
      order.order_items?.map((i: any) => i.title).filter(Boolean).join('; ') || '',
      order.created_at ? format(new Date(order.created_at), 'yyyy-MM-dd HH:mm:ss') : '',
      order.updated_at ? format(new Date(order.updated_at), 'yyyy-MM-dd HH:mm:ss') : '',
      order.shipped_at ? format(new Date(order.shipped_at), 'yyyy-MM-dd HH:mm:ss') : '',
      order.delivered_at ? format(new Date(order.delivered_at), 'yyyy-MM-dd HH:mm:ss') : '',
      order.admin_notes || ''
    ].map(escapeCSV));

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: `Exported ${selectedOrdersData.length} orders with full details`,
    });
  };

  const handleBulkDownloadReceipts = async () => {
    if (selectedOrders.size === 0) return;

    const selectedOrdersData = orders.filter(o => selectedOrders.has(o.id));
    const paidStatuses = ['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'];
    const paidOrders = selectedOrdersData.filter(o => 
      paidStatuses.includes(o.status) || o.maisha_payment_status === 'SUCCESS'
    );

    if (paidOrders.length === 0) {
      toast({
        title: 'No paid orders',
        description: 'Only paid orders have receipts available',
        variant: 'destructive',
      });
      return;
    }

    try {
      setBulkActionLoading(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      // Download receipts one by one and combine into a single window
      const receiptsHtml: string[] = [];
      
      for (const order of paidOrders) {
        const receiptUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-payment-receipt?order_id=${order.id}`;
        
        const response = await fetch(receiptUrl, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const html = await response.text();
          // Extract body content only
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          if (bodyMatch) {
            receiptsHtml.push(`
              <div class="receipt-page" style="page-break-after: always; margin-bottom: 40px;">
                ${bodyMatch[1]}
              </div>
            `);
          }
        }
      }

      if (receiptsHtml.length === 0) {
        throw new Error('Failed to generate any receipts');
      }

      // Create combined document
      const combinedHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Batch Receipts - AfriShop</title>
          <style>
            @media print {
              body { margin: 0; padding: 0; }
              .no-print { display: none; }
              .receipt-page { page-break-after: always; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #333;
              background: #f5f5f5;
              padding: 20px;
            }
            .header-bar {
              background: #2563eb;
              color: white;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 30px;
              text-align: center;
            }
            .header-bar h1 {
              margin: 0 0 10px 0;
            }
            .print-btn {
              display: inline-block;
              padding: 12px 24px;
              background: white;
              color: #2563eb;
              border: none;
              border-radius: 6px;
              font-size: 14px;
              cursor: pointer;
              font-weight: 600;
            }
            .print-btn:hover {
              background: #f0f0f0;
            }
          </style>
        </head>
        <body>
          <div class="header-bar no-print">
            <h1>📄 Batch Receipts (${receiptsHtml.length} orders)</h1>
            <button class="print-btn" onclick="window.print()">🖨️ Print All Receipts</button>
          </div>
          ${receiptsHtml.join('\n')}
        </body>
        </html>
      `;

      // Open in new window
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(combinedHtml);
        newWindow.document.close();
      }

      toast({
        title: 'Receipts generated',
        description: `Generated ${receiptsHtml.length} receipt(s) in new tab`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Count paid orders in selection
  const paidStatuses = ['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'];
  const selectedPaidCount = filteredOrders.filter(o => 
    selectedOrders.has(o.id) && (paidStatuses.includes(o.status) || o.maisha_payment_status === 'SUCCESS')
  ).length;

  return (
    <>
      <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>
                {selectedOrders.size > 0 
                  ? `${selectedOrders.size} order(s) selected` 
                  : `${filteredOrders.length} order(s) ${searchQuery ? 'found' : 'total'}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              
              {/* Date Range Filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("gap-2", dateFrom && "bg-accent")}>
                    <CalendarIcon className="h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'MMM d') : 'From'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("gap-2", dateTo && "bg-accent")}>
                    <CalendarIcon className="h-4 w-4" />
                    {dateTo ? format(dateTo, 'MMM d') : 'To'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              {(dateFrom || dateTo) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-2">
              <Button
                variant={orderTypeFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setOrderTypeFilter('all');
                  setStatusFilter('ALL');
                }}
              >
                All Orders
              </Button>
              <Button
                variant={orderTypeFilter === 'finalized' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setOrderTypeFilter('finalized');
                  setStatusFilter('ALL');
                }}
              >
                Finalized
              </Button>
              <Button
                variant={orderTypeFilter === 'non-finalized' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setOrderTypeFilter('non-finalized');
                  setStatusFilter('ALL');
                }}
              >
                Pending/Unpaid
              </Button>
            </div>
            {selectedOrders.size > 0 && (
              <>
                <Select onValueChange={handleBulkStatusUpdate} disabled={bulkActionLoading}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Update Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAID">Mark as Paid</SelectItem>
                    <SelectItem value="PROCESSING">Mark as Processing</SelectItem>
                    <SelectItem value="SHIPPED">Mark as Shipped</SelectItem>
                    <SelectItem value="COMPLETED">Mark as Completed</SelectItem>
                    <SelectItem value="CANCELLED">Mark as Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleBulkVerifyPayment}
                  disabled={bulkActionLoading}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Verify Payments
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleBulkExport}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                {selectedPaidCount > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkDownloadReceipts}
                    disabled={bulkActionLoading}
                  >
                    {bulkActionLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    Receipts ({selectedPaidCount})
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setEmailDialogOpen(true)}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send Email
                </Button>
              </>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING_PAYMENT">Pending Payment</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="PROCESSING">Processing</SelectItem>
                <SelectItem value="SHIPPED">Shipped</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
              <TableHead className="w-12">
                  <Checkbox
                    checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total (USD)</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedOrders.has(order.id)}
                      onCheckedChange={() => toggleSelectOrder(order.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {order.id.slice(0, 8)}...
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{order.profiles?.name || 'N/A'}</div>
                      <div className="text-xs text-muted-foreground">{order.profiles?.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>{order.shipping_city || 'N/A'}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs font-medium">
                        {order.order_items?.length || 0} item(s)
                      </div>
                      {order.order_items && order.order_items.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {order.order_items.slice(0, 2).map((item: any) => (
                            item.product_url ? (
                              <a
                                key={item.id}
                                href={item.product_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                                title={item.title || 'View product'}
                              >
                                {item.product_image_url && (
                                  <img 
                                    src={item.product_image_url} 
                                    alt="" 
                                    className="h-4 w-4 object-cover rounded"
                                    onError={(e) => e.currentTarget.style.display = 'none'}
                                  />
                                )}
                                <span className="line-clamp-1">{item.title?.slice(0, 20) || 'Product'}</span>
                              </a>
                            ) : null
                          ))}
                          {order.order_items.length > 2 && (
                            <span className="text-xs text-muted-foreground">+{order.order_items.length - 2} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">${Number(order.total_usd || 0).toFixed(2)}</TableCell>
                  <TableCell>{getPaymentBadge(order)}</TableCell>
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openOrderDetails(order.id)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    <OrderDetailsDrawer
      orderId={selectedOrderId}
      open={drawerOpen}
      onClose={closeOrderDetails}
      onUpdate={loadOrders}
    />

    <SendOrderEmailDialog
      open={emailDialogOpen}
      onClose={() => setEmailDialogOpen(false)}
      orderIds={Array.from(selectedOrders)}
      onSuccess={() => setSelectedOrders(new Set())}
    />
    </>
  );
}
