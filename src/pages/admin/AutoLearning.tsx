import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, TrendingUp, RefreshCw, Ban, CheckCircle, Clock, Search, Zap, Upload, Activity, AlertTriangle, Rocket, Database } from "lucide-react";
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

  const runSeedBackfill = async () => {
    setBackfillRunning(true);
    setBackfillResult(null);
    toast.info("🚀 eBay Seed Backfill started — this may take several minutes...");
    try {
      const result = await api.post<any>("admin-auto-learning?action=run-seed-backfill", {});
      if (result.error) throw new Error(result.error);
      setBackfillResult(result.data);
      const sb = result.data.seedBackfill || result.data;
      toast.success(
        `Backfill complete! Enqueued: ${sb.enqueued ?? "?"}, Processed: ${sb.processed ?? "?"}, Upserted: ${sb.upserted ?? "?"}, Errors: ${sb.errors ?? 0}`
      );
      // Refresh verification status
      fetchBackfillStatus();
      fetchData();
    } catch (err: any) {
      toast.error("Backfill failed: " + err.message);
    }
    setBackfillRunning(false);
  };

  const fetchBackfillStatus = async () => {
    try {
      const result = await api.post<BackfillStatus>("admin-auto-learning?action=backfill-status", {});
      if (result.error) throw new Error(result.error);
      setBackfillStatus(result.data);
    } catch (err: any) {
      console.error("Failed to fetch backfill status:", err);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Auto-Learning</h1>
            <p className="text-sm text-muted-foreground">
              System learns from user searches and auto-caches popular queries
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
            Run Promotion
          </Button>
        </div>
      </div>

      {/* eBay Seed Backfill Section */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            eBay Seed Backfill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enqueue ALL enabled seed queries from <code>catalog_seed_queries</code> as eBay-only jobs, then process them in controlled batches with rate limiting. Results are upserted into <code>catalog_items</code>.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={runSeedBackfill}
              disabled={backfillRunning}
              size="lg"
              className="gap-2"
            >
              <Rocket className={`h-4 w-4 ${backfillRunning ? "animate-bounce" : ""}`} />
              {backfillRunning ? "Running Backfill..." : "🚀 Run eBay Seed Backfill Now"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchBackfillStatus}>
              <Database className="h-4 w-4 mr-1" />
              Refresh Status
            </Button>
          </div>

          {/* Backfill Result */}
          {backfillResult && (
            <div className="rounded-lg border p-4 bg-background space-y-2">
              <h4 className="font-semibold text-sm">Last Backfill Result</h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                {[
                  { label: "Enqueued", value: backfillResult.seedBackfill?.enqueued ?? backfillResult.enqueued ?? "—" },
                  { label: "Processed", value: backfillResult.seedBackfill?.processed ?? backfillResult.processed ?? "—" },
                  { label: "Upserted", value: backfillResult.seedBackfill?.upserted ?? backfillResult.upserted ?? "—" },
                  { label: "Errors", value: backfillResult.seedBackfill?.errors ?? backfillResult.errors ?? 0 },
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

          {/* Verification Block */}
          {backfillStatus && (
            <div className="rounded-lg border p-4 bg-background space-y-3">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Database className="h-4 w-4" />
                Queue & Catalog Status
              </h4>

              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Queued (eBay):</span>{" "}
                  <span className="font-bold">{backfillStatus.queue.queued}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Running:</span>{" "}
                  <span className="font-bold">{backfillStatus.queue.running}</span>
                </div>
              </div>

              {backfillStatus.categories.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-center">Active Items</TableHead>
                        <TableHead className="text-center">Inactive</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {backfillStatus.categories
                        .sort((a, b) => b.active_count - a.active_count)
                        .slice(0, 20)
                        .map((cat) => (
                          <TableRow key={cat.category_key}>
                            <TableCell className="font-mono text-sm">{cat.category_key}</TableCell>
                            <TableCell className="text-center">
                              <span className={Number(cat.active_count) < 100 ? "text-destructive font-bold" : "font-bold"}>
                                {cat.active_count}
                              </span>
                            </TableCell>
                            <TableCell className="text-center text-muted-foreground">{cat.inactive_count}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider Health Panel */}
      {Object.keys(providerHealth).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Provider Health
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
              Searches (24h)
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total24h}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4" />
              Unique Queries
            </div>
            <p className="text-2xl font-bold mt-1">{stats.uniqueQueries}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Zap className="h-4 w-4" />
              Live API Hits
            </div>
            <p className="text-2xl font-bold mt-1">{stats.liveHits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CheckCircle className="h-4 w-4" />
              Auto-Promoted
            </div>
            <p className="text-2xl font-bold mt-1">{stats.promoted}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="popular" className="space-y-4">
        <TabsList>
          <TabsTrigger value="popular">Popular Searches (24h)</TabsTrigger>
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
        </TabsList>

        <TabsContent value="popular">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top User Searches</CardTitle>
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
                      <TableHead>Query</TableHead>
                      <TableHead className="text-center">Searches</TableHead>
                      <TableHead className="text-center">Avg DB Results</TableHead>
                      <TableHead className="text-center">Avg Live Results</TableHead>
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
                          <TableCell className="font-mono text-sm">{q.q_norm}</TableCell>
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
                                <CheckCircle className="h-3 w-3" /> Seeded
                              </Badge>
                            ) : needsCaching ? (
                              <Badge variant="destructive" className="gap-1">
                                Needs caching
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
              <CardTitle className="text-lg">Auto-Seed Promotions</CardTitle>
            </CardHeader>
            <CardContent>
              {promotions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No promotions yet. Click "Run Promotion" to analyze popular searches.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Query</TableHead>
                      <TableHead className="text-center">Searches</TableHead>
                      <TableHead className="text-center">Avg Results</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Promoted At</TableHead>
                      <TableHead>Last Refresh</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {promotions.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-sm">{p.query_normalized}</TableCell>
                        <TableCell className="text-center font-bold">{p.search_count}</TableCell>
                        <TableCell className="text-center">{Number(p.avg_result_count).toFixed(0)}</TableCell>
                        <TableCell>
                          {p.category_key ? (
                            <Badge variant="outline" className="text-xs">{p.category_key}</Badge>
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
                                title="Force enqueue for refresh"
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
                                title="Reject — never promote again"
                                onClick={() => updatePromotionStatus(p.id, "rejected")}
                              >
                                <Ban className="h-3 w-3" />
                              </Button>
                            )}
                            {p.status === "rejected" && (
                              <Button
                                size="sm"
                                variant="default"
                                title="Re-promote"
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