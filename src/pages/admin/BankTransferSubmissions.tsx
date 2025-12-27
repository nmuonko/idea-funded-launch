import { useState, useEffect } from "react";
import { format } from "date-fns";
import { 
  Loader2, Download, Eye, CheckCircle, XCircle, Clock, 
  Search, RefreshCcw, FileText, User, Phone, Hash, ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Submission {
  id: string;
  created_at: string;
  reference: string;
  name: string | null;
  contact: string | null;
  file_path: string;
  status: 'pending' | 'reviewing' | 'confirmed' | 'rejected';
  notes: string | null;
  reviewed_at: string | null;
}

const statusConfig = {
  pending: { label: "Pending", color: "bg-yellow-500", icon: Clock },
  reviewing: { label: "Reviewing", color: "bg-blue-500", icon: Eye },
  confirmed: { label: "Confirmed", color: "bg-green-500", icon: CheckCircle },
  rejected: { label: "Rejected", color: "bg-red-500", icon: XCircle },
};

const BankTransferSubmissions = () => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("bank_transfer_submissions")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching submissions:", error);
        toast.error("Failed to load submissions");
        return;
      }

      setSubmissions((data as Submission[]) || []);
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [statusFilter]);

  const updateStatus = async (id: string, newStatus: string) => {
    setUpdating(id);
    try {
      const { error } = await supabase
        .from("bank_transfer_submissions")
        .update({ 
          status: newStatus,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) {
        toast.error("Failed to update status");
        return;
      }

      toast.success(`Status updated to ${newStatus}`);
      fetchSubmissions();
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setUpdating(null);
    }
  };

  const getSignedUrl = async (filePath: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("bank_transfer_proofs")
        .createSignedUrl(filePath, 3600); // 1 hour expiry

      if (error) {
        toast.error("Failed to get file URL");
        return null;
      }

      return data.signedUrl;
    } catch {
      return null;
    }
  };

  const handlePreview = async (filePath: string) => {
    const url = await getSignedUrl(filePath);
    if (url) {
      setPreviewUrl(url);
    }
  };

  const handleDownload = async (filePath: string, reference: string) => {
    const url = await getSignedUrl(filePath);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `proof_${reference}_${Date.now()}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const filteredSubmissions = submissions.filter(s => 
    s.reference.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.contact?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Bank Transfer Submissions</h2>
          <p className="text-muted-foreground">
            Review and manage payment proof submissions
          </p>
        </div>
        <Button onClick={fetchSubmissions} variant="outline" className="gap-2">
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by reference, name, or contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSubmissions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No submissions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSubmissions.map((submission) => {
                    const StatusIcon = statusConfig[submission.status].icon;
                    return (
                      <TableRow key={submission.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(submission.created_at), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Hash className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono font-medium">{submission.reference}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {submission.name && (
                              <div className="flex items-center gap-2 text-sm">
                                <User className="h-3 w-3" />
                                {submission.name}
                              </div>
                            )}
                            {submission.contact && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Phone className="h-3 w-3" />
                                {submission.contact}
                              </div>
                            )}
                            {!submission.name && !submission.contact && (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${statusConfig[submission.status].color} text-white gap-1`}>
                            <StatusIcon className="h-3 w-3" />
                            {statusConfig[submission.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handlePreview(submission.file_path)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-3xl">
                                <DialogHeader>
                                  <DialogTitle>Payment Proof - {submission.reference}</DialogTitle>
                                </DialogHeader>
                                {previewUrl && (
                                  <div className="mt-4">
                                    {submission.file_path.endsWith('.pdf') ? (
                                      <iframe 
                                        src={previewUrl} 
                                        className="w-full h-[500px] rounded-lg"
                                        title="PDF Preview"
                                      />
                                    ) : (
                                      <img 
                                        src={previewUrl} 
                                        alt="Payment proof" 
                                        className="w-full max-h-[500px] object-contain rounded-lg"
                                      />
                                    )}
                                    <div className="mt-4 flex justify-end">
                                      <a 
                                        href={previewUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2"
                                      >
                                        <Button variant="outline">
                                          <ExternalLink className="h-4 w-4 mr-2" />
                                          Open in new tab
                                        </Button>
                                      </a>
                                    </div>
                                  </div>
                                )}
                              </DialogContent>
                            </Dialog>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(submission.file_path, submission.reference)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>

                            <Select
                              value={submission.status}
                              onValueChange={(value) => updateStatus(submission.id, value)}
                              disabled={updating === submission.id}
                            >
                              <SelectTrigger className="w-[130px]">
                                {updating === submission.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <SelectValue />
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="reviewing">Reviewing</SelectItem>
                                <SelectItem value="confirmed">Confirmed</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BankTransferSubmissions;