import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Wifi, Server, Shield } from 'lucide-react';
import { 
  getSupabaseConfig, 
  testSupabaseHealth, 
  testSupabaseRest,
  type HealthCheckResult 
} from '@/lib/supabaseHealth';

const ErrorTypeBadge = ({ type }: { type: HealthCheckResult['errorType'] }) => {
  const variants: Record<HealthCheckResult['errorType'], { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
    none: { label: 'OK', variant: 'default' },
    csp_blocked: { label: 'CSP Blocked', variant: 'destructive' },
    env_missing: { label: 'Env Missing', variant: 'destructive' },
    network_error: { label: 'Network Error', variant: 'destructive' },
    auth_error: { label: 'Auth Error', variant: 'destructive' },
    unknown: { label: 'Unknown', variant: 'secondary' },
  };
  
  const { label, variant } = variants[type];
  return <Badge variant={variant}>{label}</Badge>;
};

const ResultDisplay = ({ result, label }: { result: HealthCheckResult | null; label: string }) => {
  if (!result) return null;
  
  return (
    <div className="space-y-2 p-3 rounded-lg bg-muted/50">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {result.success ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          <ErrorTypeBadge type={result.errorType} />
        </div>
      </div>
      
      {result.status && (
        <p className="text-sm text-muted-foreground">
          Status: {result.status} {result.statusText}
        </p>
      )}
      
      {result.latencyMs !== undefined && (
        <p className="text-sm text-muted-foreground">
          Latency: {result.latencyMs}ms
        </p>
      )}
      
      {result.error && (
        <Alert variant="destructive" className="mt-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="font-mono text-xs break-all">
            {result.error}
          </AlertDescription>
        </Alert>
      )}
      
      {result.errorType === 'csp_blocked' && (
        <Alert className="mt-2 border-amber-500/50 bg-amber-500/10">
          <Shield className="h-4 w-4 text-amber-500" />
          <AlertTitle>CSP Issue Detected</AlertTitle>
          <AlertDescription className="text-xs">
            The browser's Content Security Policy is blocking requests to Supabase. 
            Update your hosting platform's CSP headers to include:
            <code className="block mt-1 p-2 bg-muted rounded text-xs">
              connect-src 'self' https://*.supabase.co https://*.functions.supabase.co wss://*.supabase.co;
            </code>
          </AlertDescription>
        </Alert>
      )}
      
      {result.errorType === 'env_missing' && (
        <Alert className="mt-2 border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle>Environment Variables Missing</AlertTitle>
          <AlertDescription className="text-xs">
            VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set in the build.
            Ensure these are configured in your deployment environment.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default function SupabaseDiagnostics() {
  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);
  const [restResult, setRestResult] = useState<HealthCheckResult | null>(null);
  const [loading, setLoading] = useState<'health' | 'rest' | null>(null);
  
  const config = getSupabaseConfig();
  
  const runHealthTest = async () => {
    setLoading('health');
    const result = await testSupabaseHealth();
    setHealthResult(result);
    setLoading(null);
  };
  
  const runRestTest = async () => {
    setLoading('rest');
    const result = await testSupabaseRest();
    setRestResult(result);
    setLoading(null);
  };
  
  return (
    <Card className="border-dashed border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Supabase Diagnostics</CardTitle>
          <Badge variant="outline" className="text-amber-500 border-amber-500">DEV</Badge>
        </div>
        <CardDescription>
          Debug connectivity issues with Supabase
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Config Display */}
        <div className="p-3 rounded-lg bg-muted/50 font-mono text-xs space-y-1">
          <p>
            <span className="text-muted-foreground">URL:</span>{' '}
            <span className={config.hasUrl ? 'text-green-500' : 'text-destructive'}>
              {config.url || 'NOT SET'}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Key:</span>{' '}
            <span className={config.hasKey ? 'text-green-500' : 'text-destructive'}>
              {config.hasKey ? `[${config.keyLength} chars]` : 'NOT SET'}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Hostname:</span>{' '}
            {config.hostname}
          </p>
        </div>
        
        {/* Test Buttons */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runHealthTest}
            disabled={loading !== null}
          >
            {loading === 'health' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wifi className="h-4 w-4 mr-2" />
            )}
            Test Auth Health
          </Button>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={runRestTest}
            disabled={loading !== null}
          >
            {loading === 'rest' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Server className="h-4 w-4 mr-2" />
            )}
            Test REST API
          </Button>
        </div>
        
        {/* Results */}
        <ResultDisplay result={healthResult} label="Auth Health (/auth/v1/health)" />
        <ResultDisplay result={restResult} label="REST API (/rest/v1/)" />
      </CardContent>
    </Card>
  );
}
