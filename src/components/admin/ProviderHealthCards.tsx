import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  CheckCircle2, 
  XCircle, 
  CreditCard,
  ShoppingCart,
  Cloud,
  TestTube,
  Rocket
} from 'lucide-react';

interface ProviderHealth {
  ebay: { configured: boolean; tokenValid: boolean };
  amazon: { configured: boolean; budgetRemaining: number };
  stripe: { configured: boolean; mode: 'test' | 'live' };
  pawapay: { configured: boolean };
}

interface ProviderHealthCardsProps {
  providers: ProviderHealth;
}

export function ProviderHealthCards({ providers }: ProviderHealthCardsProps) {
  const providerList = [
    {
      key: 'stripe',
      label: 'Stripe',
      icon: <CreditCard className="h-5 w-5" />,
      configured: providers.stripe.configured,
      status: providers.stripe.configured 
        ? providers.stripe.mode === 'live' ? 'Live Mode' : 'Test Mode'
        : 'Not Configured',
      statusColor: providers.stripe.configured
        ? providers.stripe.mode === 'live' 
          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
          : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
        : 'bg-muted text-muted-foreground',
      statusIcon: providers.stripe.mode === 'live' ? <Rocket className="h-3 w-3" /> : <TestTube className="h-3 w-3" />,
    },
    {
      key: 'pawapay',
      label: 'PawaPay',
      icon: <CreditCard className="h-5 w-5" />,
      configured: providers.pawapay.configured,
      status: providers.pawapay.configured ? 'Connected' : 'Not Configured',
      statusColor: providers.pawapay.configured
        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
        : 'bg-muted text-muted-foreground',
      statusIcon: providers.pawapay.configured ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />,
    },
    {
      key: 'ebay',
      label: 'eBay API',
      icon: <ShoppingCart className="h-5 w-5" />,
      configured: providers.ebay.configured,
      status: providers.ebay.configured 
        ? providers.ebay.tokenValid ? 'Token Valid' : 'Token Expired'
        : 'Not Configured',
      statusColor: providers.ebay.configured && providers.ebay.tokenValid
        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
        : providers.ebay.configured
          ? 'bg-red-500/10 text-red-500 border-red-500/20'
          : 'bg-muted text-muted-foreground',
      statusIcon: providers.ebay.configured && providers.ebay.tokenValid 
        ? <CheckCircle2 className="h-3 w-3" /> 
        : <XCircle className="h-3 w-3" />,
    },
    {
      key: 'amazon',
      label: 'Amazon',
      icon: <Cloud className="h-5 w-5" />,
      configured: providers.amazon.configured,
      status: providers.amazon.configured 
        ? `${providers.amazon.budgetRemaining} calls left`
        : 'Not Configured',
      statusColor: providers.amazon.configured
        ? providers.amazon.budgetRemaining > 50
          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
          : providers.amazon.budgetRemaining > 10
            ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
            : 'bg-red-500/10 text-red-500 border-red-500/20'
        : 'bg-muted text-muted-foreground',
      statusIcon: providers.amazon.configured 
        ? <CheckCircle2 className="h-3 w-3" /> 
        : <XCircle className="h-3 w-3" />,
    },
  ];

  const configuredCount = providerList.filter(p => p.configured).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Provider Status</CardTitle>
          </div>
          <Badge variant="outline" className="font-normal">
            {configuredCount}/{providerList.length} active
          </Badge>
        </div>
        <CardDescription className="text-sm">
          External API and payment provider health
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {providerList.map((provider) => (
            <div 
              key={provider.key}
              className={`p-3 rounded-lg border ${
                provider.configured ? 'bg-card' : 'bg-muted/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-md ${
                  provider.configured ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {provider.icon}
                </div>
                <span className="font-medium text-sm">{provider.label}</span>
              </div>
              <Badge className={`${provider.statusColor} flex items-center gap-1 w-fit`}>
                {provider.statusIcon}
                <span className="text-xs">{provider.status}</span>
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
