import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Gauge, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Brain,
  Search,
  RefreshCw
} from 'lucide-react';

interface LoadState {
  currentLoad: number;
  maxLoad: number;
  loadLevel: number;
  mode: 'normal' | 'high' | 'critical';
  features: {
    aiRecommendations: boolean;
    liveSearch: boolean;
    realtimeSync: boolean;
  };
}

interface SystemLoadWidgetProps {
  load: LoadState;
}

export function SystemLoadWidget({ load }: SystemLoadWidgetProps) {
  const loadPercent = Math.min(100, Math.round(load.loadLevel * 100));
  
  const getModeColor = () => {
    switch (load.mode) {
      case 'normal':
        return 'text-emerald-500';
      case 'high':
        return 'text-yellow-500';
      case 'critical':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getModeIcon = () => {
    switch (load.mode) {
      case 'normal':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Gauge className="h-4 w-4" />;
    }
  };

  const getModeBadge = () => {
    switch (load.mode) {
      case 'normal':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Normal</Badge>;
      case 'high':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">High Load</Badge>;
      case 'critical':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Critical</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getProgressColor = () => {
    if (loadPercent < 50) return 'bg-emerald-500';
    if (loadPercent < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const features = [
    { 
      key: 'aiRecommendations', 
      label: 'AI Recommendations', 
      icon: <Brain className="h-3.5 w-3.5" />,
      enabled: load.features.aiRecommendations 
    },
    { 
      key: 'liveSearch', 
      label: 'Live Search', 
      icon: <Search className="h-3.5 w-3.5" />,
      enabled: load.features.liveSearch 
    },
    { 
      key: 'realtimeSync', 
      label: 'Realtime Sync', 
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      enabled: load.features.realtimeSync 
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">System Load</CardTitle>
          </div>
          {getModeBadge()}
        </div>
        <CardDescription className="text-sm">
          Current system capacity and feature status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Load Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Capacity Used</span>
            <span className={`font-semibold ${getModeColor()}`}>
              {loadPercent}%
            </span>
          </div>
          <div className="relative">
            <Progress value={loadPercent} className="h-3" />
            <div 
              className={`absolute top-0 left-0 h-full rounded-full transition-all ${getProgressColor()}`}
              style={{ width: `${loadPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{load.currentLoad} active</span>
            <span>Max: {load.maxLoad}</span>
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Active Features
          </p>
          <div className="grid gap-1.5">
            {features.map((feature) => (
              <div 
                key={feature.key}
                className="flex items-center justify-between py-1.5 px-2 rounded border bg-muted/30"
              >
                <div className="flex items-center gap-2 text-sm">
                  {feature.icon}
                  <span>{feature.label}</span>
                </div>
                {feature.enabled ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mode Description */}
        {load.mode === 'critical' && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>Load shedding active. Some features temporarily disabled.</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
