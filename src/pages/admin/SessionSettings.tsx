import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings } from "lucide-react";

export default function SessionSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [targetApplicants, setTargetApplicants] = useState<number>(500);
  const [deadlineDate, setDeadlineDate] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setSessions(data || []);
      if (data && data.length > 0) {
        const firstSession = data[0];
        setSelectedSession(firstSession.id);
        setTargetApplicants(firstSession.target_applicants || 500);
        setDeadlineDate(firstSession.deadline_datetime ? new Date(firstSession.deadline_datetime).toISOString().slice(0, 16) : '');
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
      toast({
        title: "Error",
        description: "Failed to load sessions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSessionChange = (sessionId: string) => {
    setSelectedSession(sessionId);
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setTargetApplicants(session.target_applicants || 500);
      setDeadlineDate(session.deadline_datetime ? new Date(session.deadline_datetime).toISOString().slice(0, 16) : '');
    }
  };

  const handleSave = async () => {
    if (!selectedSession) {
      toast({
        title: "Error",
        description: "Please select a session",
        variant: "destructive",
      });
      return;
    }

    const session = sessions.find(s => s.id === selectedSession);
    const applicationFee = session?.application_fee || 20;

    if (applicationFee < 20) {
      toast({
        title: "Error",
        description: "Application fee must be at least $20",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('sessions')
        .update({
          target_applicants: targetApplicants,
          deadline_datetime: deadlineDate ? new Date(deadlineDate).toISOString() : null,
          application_fee: applicationFee,
          currency: session?.currency || 'USD',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSession);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Session settings updated successfully",
      });

      loadSessions();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error",
        description: "Failed to update session settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-8 w-8" />
          Session Settings
        </h1>
        <p className="text-muted-foreground">Configure target applicants and deadline for public results page</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress Bar Settings</CardTitle>
          <CardDescription>
            These settings control what is displayed on the public "Check My Status" page
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session">Select Session</Label>
            <select
              id="session"
              className="w-full rounded-md border border-input bg-background px-3 py-2"
              value={selectedSession}
              onChange={(e) => handleSessionChange(e.target.value)}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name} ({session.status})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target">Target Number of Applicants</Label>
            <Input
              id="target"
              type="number"
              min="1"
              value={targetApplicants}
              onChange={(e) => setTargetApplicants(parseInt(e.target.value) || 0)}
              placeholder="500"
            />
            <p className="text-sm text-muted-foreground">
              The goal number of paid submissions for this session
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deadline">Application Deadline</Label>
            <Input
              id="deadline"
              type="datetime-local"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              The countdown timer on the public page will show time remaining until this date
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="applicationFee">Application Fee (minimum $20)</Label>
              <Input
                id="applicationFee"
                type="number"
                min="20"
                step="0.01"
                value={sessions.find(s => s.id === selectedSession)?.application_fee || 20}
                onChange={(e) => {
                  const session = sessions.find(s => s.id === selectedSession);
                  if (session) {
                    setSessions(sessions.map(s => 
                      s.id === selectedSession 
                        ? { ...s, application_fee: parseFloat(e.target.value) || 20 }
                        : s
                    ));
                  }
                }}
                placeholder="20.00"
              />
              <p className="text-sm text-muted-foreground">
                The payment amount applicants will be charged
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <select
                id="currency"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                value={sessions.find(s => s.id === selectedSession)?.currency || 'USD'}
                onChange={(e) => {
                  const session = sessions.find(s => s.id === selectedSession);
                  if (session) {
                    setSessions(sessions.map(s => 
                      s.id === selectedSession 
                        ? { ...s, currency: e.target.value }
                        : s
                    ));
                  }
                }}
              >
                <option value="USD">USD ($)</option>
                <option value="CDF">CDF (FC)</option>
                <option value="EUR">EUR (€)</option>
              </select>
              <p className="text-sm text-muted-foreground">
                Currency for application fees
              </p>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Session Stats</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedSession && sessions.find(s => s.id === selectedSession) && (
            <div className="space-y-2">
              <p><strong>Current Participant Count:</strong> {sessions.find(s => s.id === selectedSession)?.current_participant_count || 0}</p>
              <p><strong>Target Applicants:</strong> {targetApplicants}</p>
              <p><strong>Progress:</strong> {targetApplicants > 0 ? ((sessions.find(s => s.id === selectedSession)?.current_participant_count || 0) / targetApplicants * 100).toFixed(1) : 0}%</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
