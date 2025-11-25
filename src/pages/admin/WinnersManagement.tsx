import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export default function WinnersManagement() {
  const { toast } = useToast();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  const { data: sessions } = useQuery({
    queryKey: ['sessions-for-export'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, name')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const { data: winners, isLoading } = useQuery({
    queryKey: ['winners-for-export', selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return [];
      
      const { data, error } = await supabase
        .from('winners')
        .select('*, sessions(name)')
        .eq('session_id', selectedSessionId)
        .order('display_order');
      
      if (error) throw error;
      return data;
    },
    enabled: !!selectedSessionId,
  });

  const exportToCSV = () => {
    if (!winners || winners.length === 0) {
      toast({
        title: 'No Data',
        description: 'No winners to export for this session',
        variant: 'destructive',
      });
      return;
    }

    const headers = ['Confirmation ID', 'Full Name', 'Project', 'Country', 'Award', 'Session', 'Date Exported'];
    const rows = winners.map((w: any) => [
      w.id,
      w.winner_name,
      w.project_name,
      w.country,
      `$${w.award_amount}`,
      w.sessions?.name || '',
      new Date().toISOString(),
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `winners-export-${new Date().toISOString()}.csv`;
    a.click();

    toast({
      title: 'Export Complete',
      description: 'Winners data exported to CSV',
    });
  };

  const exportToPDF = async () => {
    if (!winners || winners.length === 0) {
      toast({
        title: 'No Data',
        description: 'No winners to export for this session',
        variant: 'destructive',
      });
      return;
    }

    // Simple PDF generation using window.print with styled content
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const sessionName = winners[0]?.sessions?.name || 'Winners';
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${sessionName} - Winners Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            h1 { color: #1a365d; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #1a365d; color: white; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            .footer { margin-top: 40px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h1>${sessionName} - Winners Report</h1>
          <p>Generated on: ${new Date().toLocaleDateString()}</p>
          <table>
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Project</th>
                <th>Country</th>
                <th>Award</th>
              </tr>
            </thead>
            <tbody>
              ${winners.map((w: any) => `
                <tr>
                  <td>${w.winner_name}</td>
                  <td>${w.project_name}</td>
                  <td>${w.country}</td>
                  <td>$${w.award_amount.toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">
            <p>AfriFund - Supporting African Entrepreneurs</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();

    toast({
      title: 'Export Ready',
      description: 'PDF export dialog opened',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Winners Export</h1>
        <p className="text-muted-foreground">Export winners data for any session</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Session</Label>
            <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a session" />
              </SelectTrigger>
              <SelectContent>
                {sessions?.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {selectedSessionId && winners && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Found {winners.length} winner{winners.length !== 1 ? 's' : ''} for this session
              </p>
              
              <div className="flex gap-2">
                <Button
                  onClick={exportToCSV}
                  disabled={!winners || winners.length === 0}
                  variant="outline"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export as CSV
                </Button>
                <Button
                  onClick={exportToPDF}
                  disabled={!winners || winners.length === 0}
                  variant="outline"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Export as PDF
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
