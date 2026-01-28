import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Car, DollarSign, Clock, Users, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface CarsSettings {
  cars_api_enabled: boolean;
  cars_api_monthly_budget_usd: number;
  cars_api_budget_action: "show_cached_only" | "degrade_to_request_form";
  cars_search_limits: {
    anon_per_day: number;
    user_per_day: number;
    ip_per_hour: number;
  };
  cars_cache_ttl_minutes: number;
  cars_api_cost_per_call: number;
}

interface UsageStats {
  totalCalls: number;
  totalCost: number;
  currentMonth: string;
}

export default function CarsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [settings, setSettings] = useState<CarsSettings>({
    cars_api_enabled: true,
    cars_api_monthly_budget_usd: 50,
    cars_api_budget_action: "show_cached_only",
    cars_search_limits: { anon_per_day: 5, user_per_day: 20, ip_per_hour: 30 },
    cars_cache_ttl_minutes: 30,
    cars_api_cost_per_call: 0.01,
  });

  // Fetch settings
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["cars-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cars_settings")
        .select("key, value");
      
      if (error) throw error;
      
      const result: Record<string, any> = {};
      for (const row of data || []) {
        try {
          result[row.key] = typeof row.value === "string" ? JSON.parse(row.value as string) : row.value;
        } catch {
          result[row.key] = row.value;
        }
      }
      
      return result as Partial<CarsSettings>;
    },
  });

  // Fetch usage stats
  const { data: usageStats } = useQuery({
    queryKey: ["cars-usage-stats"],
    queryFn: async () => {
      const currentMonth = format(new Date(), "yyyy-MM");
      
      const { data, error } = await supabase
        .from("cars_api_usage")
        .select("total_calls, estimated_cost_usd")
        .eq("month", currentMonth);
      
      if (error) throw error;
      
      const totalCalls = (data || []).reduce((sum, row) => sum + (row.total_calls || 0), 0);
      const totalCost = (data || []).reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
      
      return { totalCalls, totalCost, currentMonth } as UsageStats;
    },
  });

  // Fetch cache stats
  const { data: cacheStats } = useQuery({
    queryKey: ["cars-cache-stats"],
    queryFn: async () => {
      const { count: searchCacheCount } = await supabase
        .from("cars_search_cache")
        .select("*", { count: "exact", head: true });
      
      const { count: listingsCount } = await supabase
        .from("cars_listings_cache")
        .select("*", { count: "exact", head: true });
      
      const { count: trendingCount } = await supabase
        .from("cars_listings_cache")
        .select("*", { count: "exact", head: true })
        .eq("is_trending", true);
      
      return {
        searchCacheCount: searchCacheCount || 0,
        listingsCount: listingsCount || 0,
        trendingCount: trendingCount || 0,
      };
    },
  });

  useEffect(() => {
    if (settingsData) {
      setSettings(prev => ({
        ...prev,
        ...settingsData,
        cars_search_limits: {
          ...prev.cars_search_limits,
          ...(settingsData.cars_search_limits || {}),
        },
      }));
    }
  }, [settingsData]);

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (newSettings: CarsSettings) => {
      const updates = [
        { key: "cars_api_enabled", value: newSettings.cars_api_enabled },
        { key: "cars_api_monthly_budget_usd", value: newSettings.cars_api_monthly_budget_usd },
        { key: "cars_api_budget_action", value: newSettings.cars_api_budget_action },
        { key: "cars_search_limits", value: newSettings.cars_search_limits },
        { key: "cars_cache_ttl_minutes", value: newSettings.cars_cache_ttl_minutes },
        { key: "cars_api_cost_per_call", value: newSettings.cars_api_cost_per_call },
      ];
      
      for (const update of updates) {
        const { error } = await supabase
          .from("cars_settings")
          .update({ value: update.value, updated_at: new Date().toISOString() })
          .eq("key", update.key);
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cars-settings"] });
      toast({
        title: "Settings saved",
        description: "Cars settings have been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Clear cache mutation
  const clearCacheMutation = useMutation({
    mutationFn: async (cacheType: "search" | "listings" | "all") => {
      if (cacheType === "search" || cacheType === "all") {
        await supabase.from("cars_search_cache").delete().neq("cache_key", "");
      }
      if (cacheType === "listings" || cacheType === "all") {
        await supabase.from("cars_listings_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cars-cache-stats"] });
      toast({
        title: "Cache cleared",
        description: "Cars cache has been cleared",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Car className="w-8 h-8 text-primary" />
        <h1 className="text-3xl font-bold">Cars Settings</h1>
      </div>

      {/* Usage Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              API Calls This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.totalCalls || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estimated Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(usageStats?.totalCost || 0).toFixed(2)}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                / ${settings.cars_api_monthly_budget_usd}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cached Searches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cacheStats?.searchCacheCount || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cached Listings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cacheStats?.listingsCount || 0}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({cacheStats?.trendingCount || 0} trending)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            API & Budget Settings
          </CardTitle>
          <CardDescription>
            Control API access and monthly spending limits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Cars API</Label>
              <p className="text-sm text-muted-foreground">
                Allow live searches from external API
              </p>
            </div>
            <Switch
              checked={settings.cars_api_enabled}
              onCheckedChange={(checked) => 
                setSettings(s => ({ ...s, cars_api_enabled: checked }))
              }
            />
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Monthly Budget (USD)</Label>
              <Input
                type="number"
                value={settings.cars_api_monthly_budget_usd}
                onChange={(e) => 
                  setSettings(s => ({ ...s, cars_api_monthly_budget_usd: Number(e.target.value) }))
                }
              />
            </div>
            
            <div className="space-y-2">
              <Label>Cost per API Call (USD)</Label>
              <Input
                type="number"
                step="0.001"
                value={settings.cars_api_cost_per_call}
                onChange={(e) => 
                  setSettings(s => ({ ...s, cars_api_cost_per_call: Number(e.target.value) }))
                }
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>Budget Exceeded Action</Label>
            <Select
              value={settings.cars_api_budget_action}
              onValueChange={(value: "show_cached_only" | "degrade_to_request_form") => 
                setSettings(s => ({ ...s, cars_api_budget_action: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="show_cached_only">Show Cached Results Only</SelectItem>
                <SelectItem value="degrade_to_request_form">Degrade to Request Form</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Rate Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Rate Limits
          </CardTitle>
          <CardDescription>
            Control how many searches users can perform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Anonymous Users (per day)</Label>
              <Input
                type="number"
                value={settings.cars_search_limits.anon_per_day}
                onChange={(e) => 
                  setSettings(s => ({
                    ...s,
                    cars_search_limits: {
                      ...s.cars_search_limits,
                      anon_per_day: Number(e.target.value)
                    }
                  }))
                }
              />
            </div>
            
            <div className="space-y-2">
              <Label>Logged-in Users (per day)</Label>
              <Input
                type="number"
                value={settings.cars_search_limits.user_per_day}
                onChange={(e) => 
                  setSettings(s => ({
                    ...s,
                    cars_search_limits: {
                      ...s.cars_search_limits,
                      user_per_day: Number(e.target.value)
                    }
                  }))
                }
              />
            </div>
            
            <div className="space-y-2">
              <Label>Per IP (per hour)</Label>
              <Input
                type="number"
                value={settings.cars_search_limits.ip_per_hour}
                onChange={(e) => 
                  setSettings(s => ({
                    ...s,
                    cars_search_limits: {
                      ...s.cars_search_limits,
                      ip_per_hour: Number(e.target.value)
                    }
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cache Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Cache Settings
          </CardTitle>
          <CardDescription>
            Control how long search results are cached
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Cache TTL (minutes)</Label>
            <Input
              type="number"
              value={settings.cars_cache_ttl_minutes}
              onChange={(e) => 
                setSettings(s => ({ ...s, cars_cache_ttl_minutes: Number(e.target.value) }))
              }
            />
            <p className="text-sm text-muted-foreground">
              Empty results are always cached for 2 minutes only
            </p>
          </div>
          
          <div className="flex gap-4">
            <Button 
              variant="outline" 
              onClick={() => clearCacheMutation.mutate("search")}
              disabled={clearCacheMutation.isPending}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Clear Search Cache
            </Button>
            <Button 
              variant="outline" 
              onClick={() => clearCacheMutation.mutate("listings")}
              disabled={clearCacheMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Listings Cache
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={() => saveMutation.mutate(settings)}
          disabled={saveMutation.isPending}
          size="lg"
        >
          {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
