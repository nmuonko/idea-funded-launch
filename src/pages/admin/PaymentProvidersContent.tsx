import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { CreditCard, Star, Settings, Check, X, AlertCircle, Loader2, TestTube, Clock, DollarSign, ArrowRight } from "lucide-react";

interface CurrencyLimit {
  min: number;
  max: number | null;
}

interface ProviderLimits {
  USD?: CurrencyLimit;
  CDF?: CurrencyLimit;
}

interface PaymentProvider {
  id: string;
  provider_key: string;
  display_name: string;
  is_enabled: boolean;
  is_default: boolean;
  supported_countries: string[];
  supported_methods: string[];
  priority: number;
  config_public: {
    mode?: string;
    status?: string;
    limits?: ProviderLimits;
    [key: string]: any;
  };
  secret_refs: Record<string, { ref: string; configured: boolean }>;
  secrets_configured: boolean;
  missing_secrets: string[];
}

export default function PaymentProvidersContent() {
  const queryClient = useQueryClient();
  const [editingProvider, setEditingProvider] = useState<PaymentProvider | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    priority: 100,
    mode: 'sandbox',
    usdMin: 0,
    usdMax: '',
    cdfMin: 0,
    cdfMax: '',
  });

  // Fetch providers
  const { data: providersData, isLoading, error } = useQuery({
    queryKey: ['payment-providers'],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('payments-provider', {
        body: { action: 'get_providers' },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to fetch providers');
      return response.data as { success: boolean; providers: PaymentProvider[] };
    },
  });

  // Update provider mutation
  const updateMutation = useMutation({
    mutationFn: async (params: {
      provider_key: string;
      is_enabled?: boolean;
      is_default?: boolean;
      priority?: number;
      config_public?: Record<string, any>;
    }) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('payments-provider', {
        body: { action: 'update_provider', ...params },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to update provider');
      if (!response.data.success) throw new Error(response.data.error || 'Update failed');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-providers'] });
      toast.success('Provider updated successfully');
      setEditDialogOpen(false);
      setEditingProvider(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Set active provider mutation
  const setActiveMutation = useMutation({
    mutationFn: async (provider_code: string) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('payments-provider', {
        body: { action: 'set_active', provider_code },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to set active provider');
      if (!response.data.success) throw new Error(response.data.error || 'Update failed');
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payment-providers'] });
      toast.success(data.message || 'Provider set as active');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Test provider mutation
  const testMutation = useMutation({
    mutationFn: async (provider_code: string) => {
      setTestingProvider(provider_code);
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('payments-provider', {
        body: { action: 'test_provider', provider_code },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to test provider');
      return response.data;
    },
    onSuccess: (data) => {
      setTestingProvider(null);
      if (data.success && data.status === 'configured') {
        toast.success(`${data.provider}: ${data.message}`);
      } else if (data.status === 'not_implemented') {
        toast.info(`${data.provider}: Coming soon`);
      } else {
        toast.error(`${data.provider}: ${data.message}`);
      }
    },
    onError: (error: Error) => {
      setTestingProvider(null);
      toast.error(error.message);
    },
  });

  const handleToggleEnabled = (provider: PaymentProvider) => {
    if (!provider.is_enabled && !provider.secrets_configured) {
      toast.error(`Cannot enable ${provider.display_name}: Missing secrets (${provider.missing_secrets.join(', ')})`);
      return;
    }
    if (provider.config_public?.status === 'coming_soon') {
      toast.error(`${provider.display_name} is coming soon and cannot be enabled yet`);
      return;
    }
    updateMutation.mutate({
      provider_key: provider.provider_key,
      is_enabled: !provider.is_enabled,
    });
  };

  const handleSetDefault = (provider: PaymentProvider) => {
    if (!provider.is_enabled) {
      toast.error('Cannot set disabled provider as default');
      return;
    }
    setActiveMutation.mutate(provider.provider_key);
  };

  const handleTestProvider = (provider: PaymentProvider) => {
    testMutation.mutate(provider.provider_key);
  };

  const handleSaveEdit = () => {
    if (!editingProvider) return;
    
    // Build limits object
    const limits: ProviderLimits = {};
    
    if (editingProvider.provider_key === 'stripe') {
      // Stripe only supports USD
      limits.USD = {
        min: editForm.usdMin || 0,
        max: editForm.usdMax === '' ? null : parseFloat(editForm.usdMax) || null,
      };
    } else {
      // pawaPay supports USD and CDF
      limits.USD = {
        min: editForm.usdMin || 0,
        max: editForm.usdMax === '' ? null : parseFloat(editForm.usdMax) || null,
      };
      limits.CDF = {
        min: editForm.cdfMin || 0,
        max: editForm.cdfMax === '' ? null : parseFloat(editForm.cdfMax) || null,
      };
    }
    
    updateMutation.mutate({
      provider_key: editingProvider.provider_key,
      priority: editForm.priority,
      config_public: {
        ...editingProvider.config_public,
        mode: editForm.mode,
        limits,
      },
    });
  };

  const openEditDialog = (provider: PaymentProvider) => {
    setEditingProvider(provider);
    const limits = provider.config_public?.limits || {};
    setEditForm({
      priority: provider.priority,
      mode: provider.config_public?.mode || 'sandbox',
      usdMin: limits.USD?.min || 0,
      usdMax: limits.USD?.max === null || limits.USD?.max === undefined ? '' : String(limits.USD.max),
      cdfMin: limits.CDF?.min || 0,
      cdfMax: limits.CDF?.max === null || limits.CDF?.max === undefined ? '' : String(limits.CDF.max),
    });
    setEditDialogOpen(true);
  };

  const isComingSoon = (provider: PaymentProvider) => 
    provider.config_public?.status === 'coming_soon';

  const formatLimit = (limit?: CurrencyLimit | null, currency: string = 'USD') => {
    if (!limit) return 'Not set';
    const symbol = currency === 'CDF' ? 'CDF' : '$';
    const min = currency === 'CDF' ? limit.min.toLocaleString() : limit.min.toFixed(2);
    const max = limit.max === null ? '∞' : (currency === 'CDF' ? limit.max.toLocaleString() : limit.max.toFixed(2));
    return `${symbol}${min} – ${symbol === '$' ? '' : ' '}${max}`;
  };

  const providers = providersData?.providers || [];
  const enabledProviders = providers.filter(p => p.is_enabled).sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-destructive">{(error as Error).message}</p>
          </CardContent>
        </Card>
      )}

      {/* Routing Rules Summary */}
      {enabledProviders.length > 0 && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Current Routing Rules
            </CardTitle>
            <CardDescription>
              Payments are routed by priority (lower = higher priority) and amount limits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {enabledProviders.map((provider) => (
              <div key={provider.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="w-8 justify-center">
                  {provider.priority}
                </Badge>
                <span className="font-medium">{provider.display_name}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <div className="flex flex-wrap gap-2">
                  {provider.config_public?.limits?.USD && (
                    <Badge variant="secondary">
                      USD: {formatLimit(provider.config_public.limits.USD, 'USD')}
                    </Badge>
                  )}
                  {provider.config_public?.limits?.CDF && (
                    <Badge variant="secondary">
                      CDF: {formatLimit(provider.config_public.limits.CDF, 'CDF')}
                    </Badge>
                  )}
                  {!provider.config_public?.limits?.USD && !provider.config_public?.limits?.CDF && (
                    <Badge variant="outline" className="text-muted-foreground">
                      No limits set (accepts all)
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            <Separator className="my-2" />
            <p className="text-xs text-muted-foreground">
              <strong>Vehicle orders</strong> are always routed to Stripe (USD) regardless of limits.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => (
          <Card key={provider.id} className={`${provider.is_default ? 'ring-2 ring-primary' : ''} ${isComingSoon(provider) ? 'opacity-60' : ''}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {provider.display_name}
                      {provider.is_default && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" />
                          Default
                        </Badge>
                      )}
                      {isComingSoon(provider) && (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="h-3 w-3" />
                          Coming Soon
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {provider.provider_key}
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={provider.is_enabled}
                  onCheckedChange={() => handleToggleEnabled(provider)}
                  disabled={updateMutation.isPending || isComingSoon(provider)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status indicators */}
              <div className="flex flex-wrap gap-2">
                <Badge variant={provider.is_enabled ? 'default' : 'outline'}>
                  {provider.is_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge variant="outline">
                  {provider.config_public?.mode || 'sandbox'}
                </Badge>
                <Badge variant="outline">
                  Priority: {provider.priority}
                </Badge>
              </div>

              {/* Limits display */}
              {provider.is_enabled && provider.config_public?.limits && (
                <div className="rounded-lg border p-3 bg-muted/50 text-sm space-y-1">
                  <p className="font-medium text-xs text-muted-foreground uppercase">Amount Limits</p>
                  {provider.config_public.limits.USD && (
                    <p>USD: {formatLimit(provider.config_public.limits.USD, 'USD')}</p>
                  )}
                  {provider.config_public.limits.CDF && (
                    <p>CDF: {formatLimit(provider.config_public.limits.CDF, 'CDF')}</p>
                  )}
                </div>
              )}

              {/* Secrets status */}
              <div className="flex items-center gap-2 text-sm">
                {provider.secrets_configured ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-muted-foreground">API keys configured</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">
                      Missing: {provider.missing_secrets.join(', ')}
                    </span>
                  </>
                )}
              </div>

              {/* Supported countries & methods */}
              <div className="text-sm text-muted-foreground">
                <p>Countries: {provider.supported_countries.join(', ') || 'All'}</p>
                <p>Methods: {provider.supported_methods.join(', ') || 'All'}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 flex-wrap">
                {!provider.is_default && provider.is_enabled && !isComingSoon(provider) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetDefault(provider)}
                    disabled={setActiveMutation.isPending}
                  >
                    <Star className="h-4 w-4 mr-1" />
                    Set as Default
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestProvider(provider)}
                  disabled={testMutation.isPending || isComingSoon(provider)}
                >
                  {testingProvider === provider.provider_key ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4 mr-1" />
                  )}
                  Test Config
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(provider)}
                  disabled={isComingSoon(provider)}
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Configure
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {providers.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No Payment Providers</h3>
            <p className="text-muted-foreground">
              Payment providers will appear here once configured.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Webhook Info card */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Webhook URLs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
             <span className="font-medium">Stripe:</span>
            <code className="ml-2 px-2 py-1 bg-muted rounded text-xs">
              {`${SUPABASE_URL}/functions/v1/payments-webhook/stripe`}
            </code>
          </div>
          <div>
            <span className="font-medium">pawaPay:</span>
            <code className="ml-2 px-2 py-1 bg-muted rounded text-xs">
              {`${SUPABASE_URL}/functions/v1/payments-webhook/pawapay`}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure {editingProvider?.display_name}</DialogTitle>
            <DialogDescription>
              Set priority, mode, and amount limits for routing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority (lower = higher)</Label>
                <Input
                  type="number"
                  value={editForm.priority}
                  onChange={(e) => setEditForm({ ...editForm, priority: parseInt(e.target.value) || 100 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select
                  value={editForm.mode}
                  onValueChange={(value) => setEditForm({ ...editForm, mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* USD Limits */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">USD Limits</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min ($)</Label>
                  <Input
                    type="number"
                    value={editForm.usdMin}
                    onChange={(e) => setEditForm({ ...editForm, usdMin: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Max ($ or blank = unlimited)</Label>
                  <Input
                    type="number"
                    value={editForm.usdMax}
                    onChange={(e) => setEditForm({ ...editForm, usdMax: e.target.value })}
                    placeholder="Unlimited"
                  />
                </div>
              </div>
            </div>

            {/* CDF Limits (only for pawaPay) */}
            {editingProvider?.provider_key !== 'stripe' && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">CDF Limits</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Min (CDF)</Label>
                    <Input
                      type="number"
                      value={editForm.cdfMin}
                      onChange={(e) => setEditForm({ ...editForm, cdfMin: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Max (CDF or blank = unlimited)</Label>
                    <Input
                      type="number"
                      value={editForm.cdfMax}
                      onChange={(e) => setEditForm({ ...editForm, cdfMax: e.target.value })}
                      placeholder="Unlimited"
                    />
                  </div>
                </div>
              </div>
            )}

            {editingProvider && (
              <div className="rounded-lg border p-3 bg-muted/50">
                <p className="text-sm font-medium mb-2">Secret References</p>
                {Object.entries(editingProvider.secret_refs).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {val.configured ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <X className="h-3 w-3 text-destructive" />
                    )}
                    <span className="font-mono">{key}:</span>
                    <span className="text-muted-foreground">{val.ref}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
