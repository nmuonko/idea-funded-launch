import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Loader2, Play, CheckCircle2, XCircle, Clock, Filter, AlertTriangle,
  BarChart3, Zap, Download
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';

interface ReportRow {
  id: string;
  category: string;
  query: string;
  returned_count: number;
  top3_relevant: number;
  top12_relevant: number;
  parts_bleed_rate: number;
  zero_price_count: number;
  missing_image_count: number;
  latency_ms: number;
  provider_amazon_count: number;
  provider_ebay_count: number;
  fail_reasons: string[];
  sample_top3_titles: string[];
  debug: any;
}

interface Report {
  id: string;
  created_at: string;
  env: string;
  total_queries: number;
  pass_count: number;
  fail_count: number;
  avg_latency_ms: number;
  slow_count: number;
}

type FilterMode = 'all' | 'failures' | 'slow';

export default function SearchRelevancy() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const { toast } = useToast();
  const { language } = useLanguage();

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    if (selectedReportId) loadRows(selectedReportId);
  }, [selectedReportId]);

  const loadReports = async () => {
    const { data } = await supabase
      .from('search_relevancy_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data && data.length > 0) {
      setReports(data as Report[]);
      setSelectedReportId(data[0].id);
    }
    setLoading(false);
  };

  const loadRows = async (reportId: string) => {
    const { data } = await supabase
      .from('search_relevancy_report_rows')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });
    if (data) setRows(data as ReportRow[]);
  };

  const runTests = async () => {
    setRunning(true);
    toast({ title: language === 'fr' ? 'Tests en cours...' : 'Running tests...', description: language === 'fr' ? 'Cela peut prendre 30-60 secondes' : 'This may take 30-60 seconds' });
    try {
      const { data, error } = await supabase.functions.invoke('admin-search-relevancy-run', {
        body: { env: 'production' },
      });
      if (error) throw error;
      toast({ title: language === 'fr' ? 'Tests terminés' : 'Tests complete', description: `${data.pass_count} pass, ${data.fail_count} fail` });
      await loadReports();
      if (data?.id) {
        setSelectedReportId(data.id);
        // Load rows from the returned data directly
        if (data.rows) {
          setRows(data.rows);
        }
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const selectedReport = reports.find(r => r.id === selectedReportId);

  const downloadCsv = () => {
    const headers = ['Category','Query','Returned','Top3','Top12','Parts%','$0','NoImg','Latency(ms)','Pass','Fail Reasons','Sample Top 3'];
    const csvRows = [headers.join(',')];
    for (const row of filteredRows) {
      csvRows.push([
        row.category,
        `"${row.query.replace(/"/g, '""')}"`,
        row.returned_count,
        row.top3_relevant,
        row.top12_relevant,
        Math.round(row.parts_bleed_rate * 100) + '%',
        row.zero_price_count,
        row.missing_image_count,
        row.latency_ms,
        row.fail_reasons.length === 0 ? 'PASS' : 'FAIL',
        `"${(row.fail_reasons || []).join('; ').replace(/"/g, '""')}"`,
        `"${(row.sample_top3_titles || []).join(' | ').replace(/"/g, '""')}"`,
      ].join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-relevancy-${selectedReport ? new Date(selectedReport.created_at).toISOString().slice(0,10) : 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = rows.filter(row => {
    if (filterMode === 'failures') return row.fail_reasons.length > 0;
    if (filterMode === 'slow') return row.latency_ms > 4500;
    return true;
  });

  const getRowStatus = (row: ReportRow) => row.fail_reasons.length === 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Search Relevancy</h1>
          <p className="text-muted-foreground mt-1">Automated search quality testing</p>
        </div>
        <div className="flex items-center gap-2">
          {filteredRows.length > 0 && (
            <Button variant="outline" onClick={downloadCsv}>
              <Download className="h-4 w-4 mr-2" />Download CSV
            </Button>
          )}
          <Button onClick={runTests} disabled={running} size="lg">
            {running ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running ({rows.length > 0 ? '~30s' : '~60s'})...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" />Run Tests</>
            )}
          </Button>
        </div>
      </div>

      {/* Report Selector */}
      {reports.length > 0 && (
        <div className="flex items-center gap-4">
          <Select value={selectedReportId} onValueChange={setSelectedReportId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select report" />
            </SelectTrigger>
            <SelectContent>
              {reports.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  {new Date(r.created_at).toLocaleString()} — {r.pass_count}✓ {r.fail_count}✗
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Summary Cards */}
      {selectedReport && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold">{selectedReport.total_queries}</div>
              <p className="text-sm text-muted-foreground">Total Queries</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/30">
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-emerald-500">{selectedReport.pass_count}</div>
              <p className="text-sm text-muted-foreground">Passed</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/30">
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold text-red-500">{selectedReport.fail_count}</div>
              <p className="text-sm text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold">{selectedReport.avg_latency_ms}ms</div>
              <p className="text-sm text-muted-foreground">Avg Latency</p>
            </CardContent>
          </Card>
          <Card className={selectedReport.slow_count > 0 ? "border-yellow-500/30" : ""}>
            <CardContent className="pt-6 text-center">
              <div className="text-3xl font-bold">{selectedReport.slow_count}</div>
              <p className="text-sm text-muted-foreground">Slow (&gt;4.5s)</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Button variant={filterMode === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilterMode('all')}>All</Button>
        <Button variant={filterMode === 'failures' ? 'default' : 'outline'} size="sm" onClick={() => setFilterMode('failures')}>
          <XCircle className="h-4 w-4 mr-1" /> Failures Only
        </Button>
        <Button variant={filterMode === 'slow' ? 'default' : 'outline'} size="sm" onClick={() => setFilterMode('slow')}>
          <Clock className="h-4 w-4 mr-1" /> Slow Only
        </Button>
        <span className="text-sm text-muted-foreground ml-2">{filteredRows.length} rows</span>
      </div>

      {/* Results Table */}
      {filteredRows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead className="text-center">Returned</TableHead>
                    <TableHead className="text-center">Top3</TableHead>
                    <TableHead className="text-center">Top12</TableHead>
                    <TableHead className="text-center">Parts%</TableHead>
                    <TableHead className="text-center">$0</TableHead>
                    <TableHead className="text-center">NoImg</TableHead>
                    <TableHead className="text-center">ms</TableHead>
                    <TableHead>Fail Reasons</TableHead>
                    <TableHead>Sample Top 3</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(row => {
                    const passed = getRowStatus(row);
                    return (
                      <TableRow key={row.id || row.query} className={passed ? '' : 'bg-red-500/5'}>
                        <TableCell>
                          {passed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{row.category}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm whitespace-nowrap">{row.query}</TableCell>
                        <TableCell className="text-center">{row.returned_count}</TableCell>
                        <TableCell className="text-center">
                          <span className={row.top3_relevant < 2 ? 'text-red-500 font-bold' : 'text-emerald-500'}>{row.top3_relevant}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={row.top12_relevant < 7 ? 'text-red-500 font-bold' : 'text-emerald-500'}>{row.top12_relevant}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {row.parts_bleed_rate > 0 ? (
                            <span className={row.parts_bleed_rate > 0.25 ? 'text-red-500 font-bold' : ''}>{Math.round(row.parts_bleed_rate * 100)}%</span>
                          ) : '–'}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.zero_price_count > 0 ? <span className="text-red-500">{row.zero_price_count}</span> : '0'}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.missing_image_count > 0 ? <span className="text-yellow-500">{row.missing_image_count}</span> : '0'}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={row.latency_ms > 4500 ? 'text-red-500 font-bold' : row.latency_ms > 3000 ? 'text-yellow-500' : ''}>{row.latency_ms}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {row.fail_reasons.map((r, i) => (
                              <Badge key={i} variant="destructive" className="text-[10px] px-1 py-0">{r}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[250px]">
                            {(row.sample_top3_titles || []).map((t, i) => (
                              <Tooltip key={i}>
                                <TooltipTrigger asChild>
                                  <p className="text-xs text-muted-foreground truncate">{i + 1}. {t}</p>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[400px]"><p>{t}</p></TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 && !running && (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No reports yet. Click "Run Tests" to generate the first report.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
