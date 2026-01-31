import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Archive, Hash, Clock } from 'lucide-react';

interface CacheStats {
  catalogCacheCount: number;
  productCacheCount: number;
  facetsCacheCount: number;
  rateLimitsCount: number;
}

interface CacheStatsWidgetProps {
  cache: CacheStats;
}

export function CacheStatsWidget({ cache }: CacheStatsWidgetProps) {
  const cacheItems = [
    { 
      label: 'Catalog Cache', 
      count: cache.catalogCacheCount, 
      icon: <Archive className="h-4 w-4" />,
      description: 'Search results and home data'
    },
    { 
      label: 'Product Cache', 
      count: cache.productCacheCount, 
      icon: <Database className="h-4 w-4" />,
      description: 'Product details and pricing'
    },
    { 
      label: 'Facets Cache', 
      count: cache.facetsCacheCount, 
      icon: <Hash className="h-4 w-4" />,
      description: 'Filter options for search'
    },
    { 
      label: 'Rate Limits', 
      count: cache.rateLimitsCount, 
      icon: <Clock className="h-4 w-4" />,
      description: 'Active rate limit windows'
    },
  ];

  const totalEntries = cacheItems.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Cache Status</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">
            {totalEntries.toLocaleString()} entries
          </span>
        </div>
        <CardDescription className="text-sm">
          Database cache table sizes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {cacheItems.map((item) => (
            <div 
              key={item.label}
              className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30"
            >
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  {item.icon}
                </div>
                <div>
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-lg">{item.count.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">entries</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
