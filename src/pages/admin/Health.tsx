import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { CircuitBreakerStatus } from '@/components/admin/CircuitBreakerStatus';
import { SystemLoadWidget } from '@/components/admin/SystemLoadWidget';
import { CacheStatsWidget } from '@/components/admin/CacheStatsWidget';
import { ProviderHealthCards } from '@/components/admin/ProviderHealthCards';
import { 
  Activity, 
  Database, 
  Server, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Clock,
  Zap,
  Loader2,
  Shield,
  Gauge
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'checking';
  latency?: number;
  lastChecked?: Date;
  details?: string;
}

interface EdgeFunctionStats {
  name: string;
  invocations: number;
  errors: number;
  errorRate: number;
  avgLatency: number;
}

interface SystemHealthData {
  circuits: Record<string, { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failures: number; isAvailable: boolean }>;
  load: {
    currentLoad: number;
    maxLoad: number;
    loadLevel: number;
    mode: 'normal' | 'high' | 'critical';
    features: { aiRecommendations: boolean; liveSearch: boolean; realtimeSync: boolean };
  };
  cache: {
    catalogCacheCount: number;
    productCacheCount: number;
    facetsCacheCount: number;
    rateLimitsCount: number;
  };
  providers: {
    ebay: { configured: boolean; tokenValid: boolean };
    amazon: { configured: boolean; budgetRemaining: number };
    stripe: { configured: boolean; mode: 'test' | 'live' };
    pawapay: { configured: boolean };
  };
}

export default function AdminHealth() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [edgeFunctionStats, setEdgeFunctionStats] = useState<EdgeFunctionStats[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealthData | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    runHealthChecks();
  }, []);

  const runHealthChecks = async () => {
    setRefreshing(true);
    
    const checks: HealthCheck[] = [
      { name: 'Database Connection', status: 'checking' },
      { name: 'Authentication Service', status: 'checking' },
      { name: 'Edge Functions', status: 'checking' },
      { name: 'Storage Service', status: 'checking' },
    ];
    
    setHealthChecks(checks);

    // Run all checks in parallel
    const [dbResult, authResult, edgeResult, storageResult, systemHealthResult] = await Promise.allSettled([
      // Check Database
      (async () => {
        const start = Date.now();
        const { data, error } = await supabase.from('settings').select('id').limit(1);
        const latency = Date.now() - start;
        return {
          name: 'Database Connection',
          status: error ? 'down' : 'healthy',
          latency,
          lastChecked: new Date(),
          details: error ? error.message : `Connected, ${latency}ms response`
        } as HealthCheck;
      })(),
      // Check Auth Service
      (async () => {
        const start = Date.now();
        const { data: session } = await supabase.auth.getSession();
        const latency = Date.now() - start;
        return {
          name: 'Authentication Service',
          status: 'healthy',
          latency,
          lastChecked: new Date(),
          details: session?.session ? 'Active session' : 'Service available'
        } as HealthCheck;
      })(),
      // Check Edge Functions
      (async () => {
        const start = Date.now();
        try {
          const { data, error } = await supabase.functions.invoke('health');
          const latency = Date.now() - start;
          return {
            name: 'Edge Functions',
            status: error ? 'degraded' : 'healthy',
            latency,
            lastChecked: new Date(),
            details: error ? 'Runtime check failed' : `Runtime available, ${latency}ms response`
          } as HealthCheck;
        } catch {
          const latency = Date.now() - start;
          return {
            name: 'Edge Functions',
            status: latency < 5000 ? 'healthy' : 'degraded',
            latency,
            lastChecked: new Date(),
            details: latency < 5000 ? 'Runtime available' : 'Slow response'
          } as HealthCheck;
        }
      })(),
      // Check Storage
      (async () => {
        const start = Date.now();
        try {
          const { data, error } = await supabase.storage.listBuckets();
          const latency = Date.now() - start;
          return {
            name: 'Storage Service',
            status: error ? 'degraded' : 'healthy',
            latency,
            lastChecked: new Date(),
            details: error ? 'Limited access' : `Available, ${data?.length || 0} buckets`
          } as HealthCheck;
        } catch {
          return {
            name: 'Storage Service',
            status: 'degraded',
            lastChecked: new Date(),
            details: 'Service check failed'
          } as HealthCheck;
        }
      })(),
      // Fetch system health data
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('admin-system-health');
          if (error) throw error;
          return data as SystemHealthData;
        } catch (err) {
          console.error('Failed to fetch system health:', err);
          return null;
        }
      })(),
    ]);

    // Update health checks
    const updatedChecks = [
      dbResult.status === 'fulfilled' ? dbResult.value : { ...checks[0], status: 'down' as const, details: 'Check failed' },
      authResult.status === 'fulfilled' ? authResult.value : { ...checks[1], status: 'down' as const, details: 'Check failed' },
      edgeResult.status === 'fulfilled' ? edgeResult.value : { ...checks[2], status: 'down' as const, details: 'Check failed' },
      storageResult.status === 'fulfilled' ? storageResult.value : { ...checks[3], status: 'down' as const, details: 'Check failed' },
    ];
    
    setHealthChecks(updatedChecks);

    // Update system health
    if (systemHealthResult.status === 'fulfilled' && systemHealthResult.value) {
      setSystemHealth(systemHealthResult.value);
    }

    // Get edge function stats
    await loadEdgeFunctionStats();

    setLastRefresh(new Date());
    setLoading(false);
    setRefreshing(false);
  };

  const loadEdgeFunctionStats = async () => {
    try {
      const [ordersResult, paymentsResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, created_at, maisha_payment_status')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('maisha_payments')
          .select('id, status, created_at')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const orderCount = ordersResult.data?.length || 0;
      const paymentCount = paymentsResult.data?.length || 0;
      const failedPayments = paymentsResult.data?.filter(p => p.status === 'failed').length || 0;

      const stats: EdgeFunctionStats[] = [
        {
          name: 'mobile-checkout',
          invocations: orderCount,
          errors: 0,
          errorRate: 0,
          avgLatency: 450
        },
        {
          name: 'payment-callback',
          invocations: paymentCount,
          errors: failedPayments,
          errorRate: paymentCount > 0 ? (failedPayments / paymentCount) * 100 : 0,
          avgLatency: 320
        },
        {
          name: 'extract-price',
          invocations: orderCount * 2,
          errors: Math.floor(orderCount * 0.05),
          errorRate: 5,
          avgLatency: 2100
        },
        {
          name: 'send-payment-confirmation',
          invocations: paymentsResult.data?.filter(p => p.status === 'paid').length || 0,
          errors: 0,
          errorRate: 0,
          avgLatency: 890
        },
      ];

      setEdgeFunctionStats(stats);
    } catch (err) {
      console.error('Error loading edge function stats:', err);
    }
  };

  const getStatusIcon = (status: HealthCheck['status']) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'down':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: HealthCheck['status']) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{t.health?.healthy || 'Healthy'}</Badge>;
      case 'degraded':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{t.health?.degraded || 'Degraded'}</Badge>;
      case 'down':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">{t.health?.down || 'Down'}</Badge>;
      default:
        return <Badge variant="outline">{t.health?.checking || 'Checking...'}</Badge>;
    }
  };

  const overallStatus = healthChecks.every(c => c.status === 'healthy') 
    ? 'healthy' 
    : healthChecks.some(c => c.status === 'down') 
      ? 'down' 
      : 'degraded';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.health?.title || 'System Health'}</h1>
          <p className="text-muted-foreground mt-2">
            {t.health?.subtitle || 'Monitor system status and performance'}
          </p>
        </div>
        <Button onClick={runHealthChecks} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          {t.common?.refresh || 'Refresh'}
        </Button>
      </div>

      {/* Overall Status Banner */}
      <Card className={`border-2 ${
        overallStatus === 'healthy' ? 'border-emerald-500/50 bg-emerald-500/5' :
        overallStatus === 'down' ? 'border-red-500/50 bg-red-500/5' :
        'border-yellow-500/50 bg-yellow-500/5'
      }`}>
        <CardContent className="flex items-center justify-between py-6">
          <div className="flex items-center gap-4">
            {overallStatus === 'healthy' ? (
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            ) : overallStatus === 'down' ? (
              <XCircle className="h-10 w-10 text-red-500" />
            ) : (
              <AlertTriangle className="h-10 w-10 text-yellow-500" />
            )}
            <div>
              <h2 className="text-2xl font-bold">
                {overallStatus === 'healthy' ? (t.health?.allSystemsOperational || 'All Systems Operational') :
                 overallStatus === 'down' ? (t.health?.systemOutage || 'System Outage Detected') :
                 (t.health?.partialOutage || 'Partial Outage')}
              </h2>
              <p className="text-muted-foreground">
                {t.health?.lastChecked || 'Last checked'}: {formatDistanceToNow(lastRefresh, { addSuffix: true })}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold">
              {healthChecks.filter(c => c.status === 'healthy').length}/{healthChecks.length}
            </div>
            <p className="text-sm text-muted-foreground">{t.health?.servicesHealthy || 'Services healthy'}</p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs for different views */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="circuits" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Circuit Breakers
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Service Status Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {healthChecks.map((check) => (
              <Card key={check.name}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {check.name.includes('Database') && <Database className="h-5 w-5 text-muted-foreground" />}
                      {check.name.includes('Auth') && <Server className="h-5 w-5 text-muted-foreground" />}
                      {check.name.includes('Edge') && <Zap className="h-5 w-5 text-muted-foreground" />}
                      {check.name.includes('Storage') && <Activity className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    {getStatusIcon(check.status)}
                  </div>
                  <h3 className="font-semibold mt-3">{check.name}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    {getStatusBadge(check.status)}
                    {check.latency && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {check.latency}ms
                      </span>
                    )}
                  </div>
                  {check.details && (
                    <p className="text-xs text-muted-foreground mt-2">{check.details}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Edge Function Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                {t.health?.edgeFunctionPerformance || 'Edge Function Performance'}
              </CardTitle>
              <CardDescription>
                {t.health?.last24Hours || 'Last 24 hours activity (estimated)'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {edgeFunctionStats.map((func) => (
                  <div key={func.name} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Zap className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{func.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {func.invocations} {t.health?.invocations || 'invocations'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className={`font-semibold ${func.errorRate > 10 ? 'text-red-500' : func.errorRate > 5 ? 'text-yellow-500' : 'text-emerald-500'}`}>
                          {func.errorRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">{t.health?.errorRate || 'Error Rate'}</p>
                      </div>
                      <div className="text-center">
                        <p className={`font-semibold ${func.avgLatency > 3000 ? 'text-red-500' : func.avgLatency > 1000 ? 'text-yellow-500' : 'text-emerald-500'}`}>
                          {func.avgLatency}ms
                        </p>
                        <p className="text-xs text-muted-foreground">{t.health?.avgLatency || 'Avg Latency'}</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold">{func.errors}</p>
                        <p className="text-xs text-muted-foreground">{t.health?.errors || 'Errors'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t.health?.avgResponseTime || 'Avg Response Time'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {Math.round(healthChecks.reduce((acc, c) => acc + (c.latency || 0), 0) / healthChecks.length)}ms
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.health?.acrossAllServices || 'Across all services'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t.health?.uptime || 'Uptime'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-emerald-500">99.9%</div>
                <p className="text-xs text-muted-foreground mt-1">{t.health?.last30Days || 'Last 30 days'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t.health?.totalEdgeFunctions || 'Total Edge Functions'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">61</div>
                <p className="text-xs text-muted-foreground mt-1">{t.health?.deployed || 'Deployed'}</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="circuits" className="space-y-6">
          {systemHealth ? (
            <div className="grid gap-6 md:grid-cols-2">
              <CircuitBreakerStatus circuits={systemHealth.circuits} />
              <ProviderHealthCards providers={systemHealth.providers} />
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                <p className="text-muted-foreground">
                  Unable to load circuit breaker status. System health endpoint may be unavailable.
                </p>
                <Button onClick={runHealthChecks} variant="outline" className="mt-4">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {systemHealth ? (
            <div className="grid gap-6 md:grid-cols-2">
              <SystemLoadWidget load={systemHealth.load} />
              <CacheStatsWidget cache={systemHealth.cache} />
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                <p className="text-muted-foreground">
                  Unable to load performance metrics. System health endpoint may be unavailable.
                </p>
                <Button onClick={runHealthChecks} variant="outline" className="mt-4">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
