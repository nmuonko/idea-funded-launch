import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  WifiOff, 
  RefreshCw, 
  Copy, 
  Check, 
  ShieldAlert, 
  Globe, 
  Loader2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { testSupabaseHealth, checkForBlockers, getSupabaseConfig } from '@/lib/supabaseHealth';
import { useToast } from '@/hooks/use-toast';

interface NetworkBlockedBannerProps {
  onRetrySuccess?: () => void;
}

export function NetworkBlockedBanner({ onRetrySuccess }: NetworkBlockedBannerProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [retryResult, setRetryResult] = useState<{ success: boolean; message: string } | null>(null);
  const { toast } = useToast();
  
  const config = getSupabaseConfig();
  const supabaseDomain = config.url ? new URL(config.url).hostname : 'supabase.co';

  const handleCopyDomain = async () => {
    try {
      await navigator.clipboard.writeText(supabaseDomain);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: `Add "${supabaseDomain}" to your allowlist`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Please manually copy: ' + supabaseDomain,
        variant: 'destructive',
      });
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryResult(null);
    
    try {
      // First check if external requests work at all
      const blockerCheck = await checkForBlockers();
      
      // Then test Supabase specifically
      const healthResult = await testSupabaseHealth();
      
      if (healthResult.success) {
        setRetryResult({ success: true, message: 'Connection restored! Refreshing...' });
        toast({
          title: 'Connection Restored!',
          description: 'Supabase is now reachable. Refreshing the page...',
        });
        setTimeout(() => {
          onRetrySuccess?.();
          window.location.reload();
        }, 1000);
      } else {
        const message = blockerCheck.blocked 
          ? 'All external requests are blocked. Check your network connection or firewall.'
          : `Supabase specifically blocked. ${blockerCheck.reason}`;
        setRetryResult({ success: false, message });
      }
    } catch (error: any) {
      setRetryResult({ 
        success: false, 
        message: `Retry failed: ${error.message}` 
      });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className="bg-destructive/5 border-destructive/30 shadow-lg animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-destructive/20">
            <WifiOff className="h-5 w-5 text-destructive" />
          </div>
          <CardTitle className="text-lg text-destructive">
            Connection Blocked
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Cannot reach Supabase servers</AlertTitle>
          <AlertDescription className="mt-2">
            Your browser or network is blocking connections to <code className="bg-background/50 px-1 rounded">{supabaseDomain}</code>.
            This is usually caused by ad-blockers, privacy extensions, VPNs, or corporate firewalls.
          </AlertDescription>
        </Alert>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            onClick={handleRetry}
            disabled={isRetrying}
            className="w-full"
          >
            {isRetrying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Connection
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={handleCopyDomain}
            className="w-full"
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Domain
              </>
            )}
          </Button>
        </div>

        {/* Retry Result */}
        {retryResult && (
          <Alert variant={retryResult.success ? 'default' : 'destructive'} className={retryResult.success ? 'bg-green-500/10 border-green-500/30' : ''}>
            <Globe className="h-4 w-4" />
            <AlertDescription>{retryResult.message}</AlertDescription>
          </Alert>
        )}

        {/* Expandable Solutions */}
        <Button 
          variant="ghost" 
          className="w-full justify-between text-muted-foreground hover:text-foreground"
          onClick={() => setShowDetails(!showDetails)}
        >
          <span>How to fix this</span>
          {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {showDetails && (
          <div className="space-y-3 text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
            <div className="space-y-2">
              <p className="font-medium text-foreground">Try these solutions:</p>
              <ol className="list-decimal list-inside space-y-2 ml-1">
                <li>
                  <span className="font-medium">Disable ad-blockers</span> — uBlock Origin, AdBlock, and privacy extensions often block <code className="bg-background px-1 rounded text-xs">*.supabase.co</code>
                </li>
                <li>
                  <span className="font-medium">Try Incognito/Private mode</span> — Opens browser without extensions
                </li>
                <li>
                  <span className="font-medium">Disconnect VPN</span> — Some VPNs block database services
                </li>
                <li>
                  <span className="font-medium">Use mobile hotspot</span> — Bypasses corporate/home network restrictions
                </li>
                <li>
                  <span className="font-medium">Add to allowlist</span> — Whitelist <code className="bg-background px-1 rounded text-xs">{supabaseDomain}</code> in your ad-blocker settings
                </li>
              </ol>
            </div>
            
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs">
                <span className="font-medium">Technical:</span> The browser cannot complete HTTPS requests to {supabaseDomain}. 
                Error: <code className="bg-background px-1 rounded">Failed to fetch</code> / <code className="bg-background px-1 rounded">TypeError</code>
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
