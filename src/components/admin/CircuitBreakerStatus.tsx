import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Zap,
  CreditCard,
  Mail,
  Brain,
  ShoppingCart,
  Cloud
} from 'lucide-react';

interface CircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  isAvailable: boolean;
  lastFailure?: string;
}

interface CircuitBreakerStatusProps {
  circuits: Record<string, CircuitState>;
}

const circuitConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  pawapay: { label: 'PawaPay', icon: <CreditCard className="h-4 w-4" /> },
  stripe: { label: 'Stripe', icon: <CreditCard className="h-4 w-4" /> },
  resend: { label: 'Email (Resend)', icon: <Mail className="h-4 w-4" /> },
  openai: { label: 'OpenAI', icon: <Brain className="h-4 w-4" /> },
  ebay: { label: 'eBay API', icon: <ShoppingCart className="h-4 w-4" /> },
  rainforest: { label: 'Amazon (Rainforest)', icon: <Cloud className="h-4 w-4" /> },
};

export function CircuitBreakerStatus({ circuits }: CircuitBreakerStatusProps) {
  const getStateColor = (state: CircuitState['state'], isAvailable: boolean) => {
    if (!isAvailable) return 'bg-muted text-muted-foreground';
    switch (state) {
      case 'CLOSED':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'HALF_OPEN':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'OPEN':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStateIcon = (state: CircuitState['state'], isAvailable: boolean) => {
    if (!isAvailable) return <XCircle className="h-4 w-4 text-muted-foreground" />;
    switch (state) {
      case 'CLOSED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'HALF_OPEN':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'OPEN':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStateLabel = (state: CircuitState['state'], isAvailable: boolean) => {
    if (!isAvailable) return 'Not Configured';
    switch (state) {
      case 'CLOSED':
        return 'Healthy';
      case 'HALF_OPEN':
        return 'Recovering';
      case 'OPEN':
        return 'Circuit Open';
      default:
        return 'Unknown';
    }
  };

  const sortedCircuits = Object.entries(circuits).sort((a, b) => {
    // Sort by availability first, then by state
    if (a[1].isAvailable !== b[1].isAvailable) {
      return a[1].isAvailable ? -1 : 1;
    }
    const stateOrder = { OPEN: 0, HALF_OPEN: 1, CLOSED: 2 };
    return stateOrder[a[1].state] - stateOrder[b[1].state];
  });

  const healthyCount = Object.values(circuits).filter(
    c => c.isAvailable && c.state === 'CLOSED'
  ).length;
  const configuredCount = Object.values(circuits).filter(c => c.isAvailable).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Circuit Breakers</CardTitle>
          </div>
          <Badge variant="outline" className="font-normal">
            {healthyCount}/{configuredCount} healthy
          </Badge>
        </div>
        <CardDescription className="text-sm">
          External service connectivity status
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {sortedCircuits.map(([key, circuit]) => {
            const config = circuitConfig[key] || { label: key, icon: <Zap className="h-4 w-4" /> };
            
            return (
              <div 
                key={key}
                className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-md bg-muted">
                    {config.icon}
                  </div>
                  <span className="font-medium text-sm">{config.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {circuit.failures > 0 && circuit.isAvailable && (
                    <span className="text-xs text-muted-foreground">
                      {circuit.failures} failures
                    </span>
                  )}
                  <Badge className={`${getStateColor(circuit.state, circuit.isAvailable)} flex items-center gap-1`}>
                    {getStateIcon(circuit.state, circuit.isAvailable)}
                    <span className="text-xs">{getStateLabel(circuit.state, circuit.isAvailable)}</span>
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
