import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Brain, TrendingUp, RefreshCw, Ban, CheckCircle, Clock, Search, Zap, Upload, Activity, AlertTriangle, Rocket, Database, Square } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface SearchLogAgg {
  q_norm: string;
  search_count: number;
  avg_live: number;
  avg_db: number;
  last_seen: string;
  category_guess: string | null;
}

interface Promotion {
  id: string;
  query_normalized: string;
  search_count: number;
  avg_result_count: number;
  status: string;
  promoted_at: string | null;
  created_at: string;
  admin_notes: string | null;
  category_key: string | null;
  last_refreshed_at: string | null;
  last_refresh_count: number | null;
  last_refresh_status: string | null;
}

interface ProviderHealth {
  healthy: boolean;
  reason: string | null;
  retryAfterSec: number;
}

interface BackfillStatus {
  queue: { queued: number; running: number };
  categories: { category_key: string; active_count: number; inactive_count: number }[];
}

const formatCategoryName = (key: string) => {
  // Hide raw numeric keys — they're not meaningful category names
  if (/^\d+$/.test(key)) return null;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

const getCategoryColor = (count: number) => {
  if (count >= 2000) return "bg-green-500";
  if (count >= 500) return "bg-yellow-500";
  return "bg-red-500";
};

export default function AutoLearning() {
  const [popularQueries, setPopularQueries] = useState<SearchLogAgg[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [enqueuingId, setEnqueueingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ total24h: 0, uniqueQueries: 0, liveHits: 0, promoted: 0 });
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealth>>({});
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [autoPolling, setAutoPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>("admin-auto-learning?action=dashboard");
      if (result.error) throw new Error(result.error);
      const d = result.data;
      setPopularQueries(d.popular || []);
      setPromotions(d.promotions || []);
      setStats(d.stats || { total24h: 0, uniqueQueries: 0, liveHits: 0, promoted: 0 });
      setProviderHealth(d.providerHealth || {});
    } catch (err: any) {
      console.error("Failed to fetch auto-learning data:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runPromotion = async () => {
    setPromoting(true);
    try {
      const result = await api.post<any>("admin-auto-learning?action=run-promotion", {});
      if (result.error) throw new Error(result.error);
      const data = result.data;
      toast.success(`Promoted ${data.promoted} queries, enqueued ${data.enqueued} refresh jobs (${data.spam_filtered} spam filtered)`);
      fetchData();
    } catch (err: any) {
      toast.error("Promotion failed: " + err.message);
    }
    setPromoting(false);
  };

  const updatePromotionStatus = async (id: string, status: string) => {
    try {
      const result = await api.post<any>("admin-auto-learning?action=update-status", { id, status });
      if (result.error) throw new Error(result.error);
      toast.success(`Status updated to ${status}`);
      fetchData();
    } catch (err: any) {
      toast.error("Failed to update: " + err.message);
    }
  };

  const manualEnqueue = async (id: string) => {
    setEnqueueingId(id);
    try {
      const result = await api.post<any>("admin-auto-learning?action=manual-enqueue", { id });
      if (result.error) throw new Error(result.error);
      toast.success("Manually enqueued for refresh");
      fetchData();
    } catch (err: any) {
      toast.error("Enqueue failed: " + err.message);
    }
    setEnqueueingId(null);
  };

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setAutoPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling(); // clear any existing
    setAutoPolling(true);

    pollingRef.current = setInterval(async () => {
      try {
        // Fetch current status
        const statusResult = await api.post<BackfillStatus>("admin-auto-learning?action=backfill-status", {});
        if (statusResult.error) throw new Error(statusResult.error);
        setBackfillStatus(statusResult.data);

        const queued = statusResult.data?.queue?.queued ?? 0;
        if (queued === 0) {
          toast.success("✅ All products imported! Queue is empty.");
          stopPolling();
          fetchData();
          return;
        }

        // Trigger another batch via continue-backfill (queue mode)
        const batchResult = await api.post<any>("admin-auto-learning?action=continue-backfill", {});
        if (batchResult.error) {
          console.warn("Continue-backfill batch error:", batchResult.error);
        } else {
          setBackfillResult(batchResult.data);
        }

        // Refresh status after batch
        const updatedStatus = await api.post<BackfillStatus>("admin-auto-learning?action=backfill-status", {});
        if (!updatedStatus.error) setBackfillStatus(updatedStatus.data);
      } catch (err: any) {
        console.error("Polling error:", err);
      }
    }, 30000); // every 30 seconds
  }, [stopPolling, fetchData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const runSeedBackfill = async () => {
    setBackfillRunning(true);
    setBackfillResult(null);
    toast.info("🚀 Bulk product import started — this may take several minutes...");
    try {
      const result = await api.post<any>("admin-auto-learning?action=run-seed-backfill", {});
      if (result.error) throw new Error(result.error);
      setBackfillResult(result.data);
      const sb = result.data.seedBackfill || result.data;
      toast.success(
        `Import batch done! Queued: ${sb.enqueued ?? "?"}, Checked: ${sb.processed ?? "?"}, Products Added: ${sb.upserted ?? "?"}, Failed: ${sb.errors ?? 0}`
      );
      fetchBackfillStatus();
      fetchData();
      // Start auto-polling to drain remaining queue
      startPolling();
    } catch (err: any) {
      toast.error("Import failed: " + err.message);
    }
    setBackfillRunning(false);
  };

  const fetchBackfillStatus = async (showToast = false) => {
    try {
      const result = await api.post<BackfillStatus>("admin-auto-learning?action=backfill-status", {});
      if (result.error) throw new Error(result.error);
      setBackfillStatus(result.data);
      if (showToast) toast.success("Status refreshed");
    } catch (err: any) {
      console.error("Failed to fetch backfill status:", err);
      if (showToast) toast.error("Failed to refresh status");
    }
  };

  useEffect(() => { fetchBackfillStatus(); }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
      promoted: { variant: "default", icon: CheckCircle },
      candidate: { variant: "secondary", icon: Clock },
      rejected: { variant: "destructive", icon: Ban },
      expired: { variant: "outline", icon: Clock },
    };
    const s = map[status] || map.candidate;
    return (
      <Badge variant={s.variant} className="gap-1">
        <s.icon className="h-3 w-3" />
        {status}
      </Badge>
    );
  };

  const formatRetryAfter = (seconds: number) => {
    if (seconds <= 0) return "";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  const maxActiveCount = backfillStatus?.categories
    ? Math.max(...backfillStatus.categories.map((c) => c.active_count), 1)
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Smart Product Updates</h1>
            <p className="text-sm text-muted-foreground">
              Automatically finds and adds products based on what your customers search for
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={runPromotion} disabled={promoting}>
            <Zap className={`h-4 w-4 mr-2 ${promoting ? "animate-spin" : ""}`} />
            Find New Trends
          </Button>
        </div>
      </div>

      {/* Bulk Product Import Section */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Bulk Product Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Import products for all your saved product categories from eBay. This runs in the background and may take a few minutes.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={runSeedBackfill}
              disabled={backfillRunning || autoPolling}
              size="lg"
              className="gap-2"
            >
              <Rocket className={`h-4 w-4 ${backfillRunning ? "animate-bounce" : ""}`} />
              {backfillRunning ? "Importing Products..." : "🚀 Start Bulk Import"}
            </Button>
            {autoPolling && (
              <Button variant="destructive" size="sm" onClick={stopPolling} className="gap-2">
                <Square className="h-4 w-4" />
                Stop Import
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => fetchBackfillStatus(true)}>
              <Database className="h-4 w-4 mr-1" />
              Refresh Status
            </Button>
          </div>

          {/* Auto-polling indicator */}
          {autoPolling && backfillStatus && (
            <div className="space-y-2 rounded-lg border border-primary/30 p-3 bg-primary/5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                Auto-importing: {backfillStatus.queue.queued} jobs remaining
              </div>
              <p className="text-xs text-muted-foreground">
                Processing 50 products every 30 seconds. You can leave this page — the background cron will continue processing.
              </p>
              <Progress 
                value={backfillStatus.queue.queued > 0 ? Math.max(5, 100 - (backfillStatus.queue.queued / 5)) : 100} 
                className="h-2" 
              />
            </div>
          )}

          {/* Backfill progress bar when running */}
          {backfillRunning && !autoPolling && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Importing products...
              </div>
              <Progress value={undefined} className="h-2 [&>div]:animate-pulse" />
            </div>
          )}

          {/* Backfill Result */}
          {backfillResult && (
            <div className="rounded-lg border p-4 bg-background space-y-2">
              <h4 className="font-semibold text-sm">Last Import Result</h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                {[
                  { label: "Queued", value: backfillResult.seedBackfill?.enqueued ?? backfillResult.enqueued ?? "—" },
                  { label: "Checked", value: backfillResult.seedBackfill?.processed ?? backfillResult.processed ?? "—" },
                  { label: "Products Added", value: backfillResult.seedBackfill?.upserted ?? backfillResult.upserted ?? "—" },
                  { label: "Failed", value: backfillResult.seedBackfill?.errors ?? backfillResult.errors ?? 0 },
                  { label: "Duration", value: `${((backfillResult.totalDurationMs || backfillResult.durationMs || 0) / 1000).toFixed(1)}s` },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <p className="text-muted-foreground text-xs">{item.label}</p>
                    <p className="font-bold text-lg">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import Progress Block */}
          {backfillStatus && (
            <div className="rounded-lg border p-4 bg-background space-y-3">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Database className="h-4 w-4" />
                Import Progress
              </h4>

              <div className="flex gap-6 text-sm">
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Waiting to import</span>
                    <span className="font-bold">{backfillStatus.queue.queued}</span>
                  </div>
                  {backfillStatus.queue.queued > 0 && (
                    <Progress value={100} className="h-2 [&>div]:bg-yellow-500" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Currently importing</span>
                    <span className="font-bold">{backfillStatus.queue.running}</span>
                  </div>
                  {backfillStatus.queue.running > 0 && (
                    <Progress value={100} className="h-2 [&>div]:bg-blue-500 [&>div]:animate-pulse" />
                  )}
                </div>
              </div>

              {backfillStatus.categories.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Products Available</TableHead>
                        <TableHead className="text-center">Hidden</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {backfillStatus.categories
                        .filter((cat) => !/^\d+$/.test(cat.category_key))
                        .sort((a, b) => b.active_count - a.active_count)
                        .slice(0, 20)
                        .map((cat) => {
                          const pct = (cat.active_count / maxActiveCount) * 100;
                          const colorClass = getCategoryColor(cat.active_count);
                          return (
                            <TableRow key={cat.category_key}>
                              <TableCell className="font-medium text-sm">
                                {formatCategoryName(cat.category_key)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <div className="flex-1 min-w-[120px]">
                                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${colorClass}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                  <span className={`text-sm font-bold min-w-[50px] text-right ${cat.active_count < 100 ? "text-destructive" : ""}`}>
                                    {cat.active_count.toLocaleString()}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-muted-foreground">{cat.inactive_count.toLocaleString()}</TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Sources Panel */}
      {Object.keys(providerHealth).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Data Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(providerHealth).map(([provider, health]) => (
                <div
                  key={provider}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    health.healthy
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <div className={`h-3 w-3 rounded-full ${health.healthy ? "bg-green-500" : "bg-destructive animate-pulse"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold capitalize text-sm">{provider}</p>
                    {health.healthy ? (
                      <p className="text-xs text-muted-foreground">Healthy</p>
                    ) : (
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                        <p className="text-xs text-destructive truncate">
                          {health.reason}{health.retryAfterSec > 0 ? ` · retry ${formatRetryAfter(health.retryAfterSec)}` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Search className="h-4 w-4" />
              Customer Searches Today
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total24h}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4" />
              Different Products Searched
            </div>
            <p className="text-2xl font-bold mt-1">{stats.uniqueQueries}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Zap className="h-4 w-4" />
              External Lookups
            </div>
            <p className="text-2xl font-bold mt-1">{stats.liveHits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CheckCircle className="h-4 w-4" />
              Auto-Added
            </div>
            <p className="text-2xl font-bold mt-1">{stats.promoted}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="popular" className="space-y-4">
        <TabsList>
          <TabsTrigger value="popular">Trending Searches</TabsTrigger>
          <TabsTrigger value="promotions">Auto-Added Products</TabsTrigger>
        </TabsList>

        <TabsContent value="popular">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Customer Searches</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted-foreground text-center py-8">Loading...</p>
              ) : popularQueries.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No search data in the last 24 hours</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>What customers searched</TableHead>
                      <TableHead className="text-center">Searches</TableHead>
                      <TableHead className="text-center">Saved Results</TableHead>
                      <TableHead className="text-center">Found Online</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Last Searched</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {popularQueries.slice(0, 50).map((q) => {
                      const isPromoted = promotions.some(p => p.query_normalized === q.q_norm && p.status === "promoted");
                      const needsCaching = Number(q.avg_db) < 5 && Number(q.search_count) >= 3;
                      return (
                        <TableRow key={q.q_norm} className={needsCaching ? "bg-destructive/5" : ""}>
                          <TableCell className="font-medium text-sm">{q.q_norm}</TableCell>
                          <TableCell className="text-center font-bold">{q.search_count}</TableCell>
                          <TableCell className="text-center">
                            <span className={Number(q.avg_db) < 5 ? "text-destructive font-bold" : ""}>
                              {q.avg_db}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">{q.avg_live}</TableCell>
                          <TableCell>
                            {q.category_guess ? (
                              <Badge variant="outline" className="text-xs">{q.category_guess}</Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(q.last_seen).toLocaleTimeString()}
                          </TableCell>
                          <TableCell className="text-center">
                            {isPromoted ? (
                              <Badge variant="default" className="gap-1">
                                <CheckCircle className="h-3 w-3" /> Added
                              </Badge>
                            ) : needsCaching ? (
                              <Badge variant="destructive" className="gap-1">
                                Needs products
                              </Badge>
                            ) : (
                              <Badge variant="secondary">OK</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="promotions">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Auto-Added Products</CardTitle>
            </CardHeader>
            <CardContent>
              {promotions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No auto-added products yet. Click "Find New Trends" to analyze popular searches.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>What customers searched</TableHead>
                      <TableHead className="text-center">Searches</TableHead>
                      <TableHead className="text-center">Avg Results</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added At</TableHead>
                      <TableHead>Last Refresh</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {promotions.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-sm">{p.query_normalized}</TableCell>
                        <TableCell className="text-center font-bold">{p.search_count}</TableCell>
                        <TableCell className="text-center">{Number(p.avg_result_count).toFixed(0)}</TableCell>
                        <TableCell>
                          {p.category_key ? (
                            <Badge variant="outline" className="text-xs">{formatCategoryName(p.category_key)}</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.promoted_at ? new Date(p.promoted_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>
                          {p.last_refreshed_at ? (
                            <div className="text-xs">
                              <span className={`font-medium ${p.last_refresh_status === "success" ? "text-green-600" : "text-muted-foreground"}`}>
                                {p.last_refresh_count ?? 0} items
                              </span>
                              <br />
                              <span className="text-muted-foreground">
                                {new Date(p.last_refreshed_at).toLocaleString()}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {p.status !== "rejected" && (
                              <Button
                                size="sm"
                                variant="outline"
                                title="Force refresh"
                                disabled={enqueuingId === p.id}
                                onClick={() => manualEnqueue(p.id)}
                              >
                                <Upload className={`h-3 w-3 ${enqueuingId === p.id ? "animate-spin" : ""}`} />
                              </Button>
                            )}
                            {p.status !== "rejected" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                title="Reject — never add again"
                                onClick={() => updatePromotionStatus(p.id, "rejected")}
                              >
                                <Ban className="h-3 w-3" />
                              </Button>
                            )}
                            {p.status === "rejected" && (
                              <Button
                                size="sm"
                                variant="default"
                                title="Re-add"
                                onClick={() => updatePromotionStatus(p.id, "promoted")}
                              >
                                <CheckCircle className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
