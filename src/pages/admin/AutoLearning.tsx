import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, TrendingUp, RefreshCw, Ban, CheckCircle, Clock, Search, Zap } from "lucide-react";
import { toast } from "sonner";

interface SearchLogAgg {
  q_norm: string;
  search_count: number;
  avg_live: number;
  avg_db: number;
  last_searched: string;
  category: string | null;
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
}

export default function AutoLearning() {
  const [popularQueries, setPopularQueries] = useState<SearchLogAgg[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [stats, setStats] = useState({ total24h: 0, uniqueQueries: 0, liveHits: 0, promoted: 0 });

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch popular queries (last 24h aggregated)
      const { data: logs } = await supabase
        .from("search_query_log")
        .select("q_norm, live_count, db_count, category_guess, created_at")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);

      if (logs) {
        // Aggregate by query
        const map = new Map<string, { count: number; liveTotals: number; dbTotals: number; last: string; cat: string | null }>();
        logs.forEach((l: any) => {
          const key = l.q_norm;
          const existing = map.get(key);
          if (existing) {
            existing.count++;
            existing.liveTotals += l.live_count || 0;
            existing.dbTotals += l.db_count || 0;
            if (l.created_at > existing.last) existing.last = l.created_at;
          } else {
            map.set(key, {
              count: 1,
              liveTotals: l.live_count || 0,
              dbTotals: l.db_count || 0,
              last: l.created_at,
              cat: l.category_guess,
            });
          }
        });

        const agg: SearchLogAgg[] = Array.from(map.entries())
          .map(([q, v]) => ({
            q_norm: q,
            search_count: v.count,
            avg_live: v.count > 0 ? Math.round(v.liveTotals / v.count) : 0,
            avg_db: v.count > 0 ? Math.round(v.dbTotals / v.count) : 0,
            last_searched: v.last,
            category: v.cat,
          }))
          .sort((a, b) => b.search_count - a.search_count);

        setPopularQueries(agg);
        setStats({
          total24h: logs.length,
          uniqueQueries: map.size,
          liveHits: logs.filter((l: any) => l.live_count > 0).length,
          promoted: 0,
        });
      }

      // Fetch promotions
      const { data: promos } = await supabase
        .from("auto_seed_promotions")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100);

      if (promos) {
        setPromotions(promos as Promotion[]);
        setStats(s => ({ ...s, promoted: promos.filter((p: any) => p.status === "promoted").length }));
      }
    } catch (err) {
      console.error("Failed to fetch auto-learning data:", err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const runPromotion = async () => {
    setPromoting(true);
    try {
      const { data, error } = await supabase.rpc("promote_popular_searches", {
        p_min_searches: 3,
        p_window_hours: 24,
        p_auto_enqueue: true,
      });
      if (error) throw error;
      const result = data as any;
      toast.success(`Promoted ${result.promoted} queries, enqueued ${result.enqueued} refresh jobs`);
      fetchData();
    } catch (err: any) {
      toast.error("Promotion failed: " + err.message);
    }
    setPromoting(false);
  };

  const updatePromotionStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("auto_seed_promotions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Failed to update: " + error.message);
    } else {
      toast.success(`Status updated to ${status}`);
      fetchData();
    }
  };

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

  return (
    <>
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

          {/* Popular Searches Tab */}
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
                        const needsCaching = q.avg_db < 5 && q.search_count >= 3;
                        return (
                          <TableRow key={q.q_norm} className={needsCaching ? "bg-destructive/5" : ""}>
                            <TableCell className="font-mono text-sm">{q.q_norm}</TableCell>
                            <TableCell className="text-center font-bold">{q.search_count}</TableCell>
                            <TableCell className="text-center">
                              <span className={q.avg_db < 5 ? "text-destructive font-bold" : ""}>
                                {q.avg_db}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">{q.avg_live}</TableCell>
                            <TableCell>
                              {q.category ? (
                                <Badge variant="outline" className="text-xs">{q.category}</Badge>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(q.last_searched).toLocaleTimeString()}
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

          {/* Promotions Tab */}
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
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              {p.status !== "rejected" && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => updatePromotionStatus(p.id, "rejected")}
                                >
                                  <Ban className="h-3 w-3" />
                                </Button>
                              )}
                              {p.status === "rejected" && (
                                <Button
                                  size="sm"
                                  variant="default"
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
    </>
  );
}
