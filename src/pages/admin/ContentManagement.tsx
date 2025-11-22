import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileText, Save } from "lucide-react";

interface ContentItem {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

export default function ContentManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [editedContents, setEditedContents] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadContent();
  }, []);

  const loadContent = async () => {
    try {
      const { data, error } = await supabase
        .from('site_content')
        .select('*')
        .order('key');

      if (error) throw error;

      setContents(data || []);
      // Initialize edited contents with current values
      const initialEdits: Record<string, string> = {};
      data?.forEach(item => {
        initialEdits[item.key] = item.value;
      });
      setEditedContents(initialEdits);
    } catch (error) {
      console.error('Error loading content:', error);
      toast({
        title: "Error",
        description: "Failed to load site content",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('site_content')
        .update({ value: editedContents[key], updated_at: new Date().toISOString() })
        .eq('key', key);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Content updated successfully",
      });

      loadContent();
    } catch (error) {
      console.error('Error saving content:', error);
      toast({
        title: "Error",
        description: "Failed to update content",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setEditedContents(prev => ({
      ...prev,
      [key]: value
    }));
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
          <FileText className="h-8 w-8" />
          Content Management
        </h1>
        <p className="text-muted-foreground">Edit website text without touching code</p>
      </div>

      <div className="grid gap-6">
        {contents.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="text-lg">{item.key}</CardTitle>
              {item.description && (
                <CardDescription>{item.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={item.key}>Content</Label>
                {item.value.length > 100 ? (
                  <Textarea
                    id={item.key}
                    value={editedContents[item.key] || ''}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                    rows={4}
                    className="font-mono text-sm"
                  />
                ) : (
                  <Input
                    id={item.key}
                    value={editedContents[item.key] || ''}
                    onChange={(e) => handleChange(item.key, e.target.value)}
                  />
                )}
              </div>
              <Button 
                onClick={() => handleSave(item.key)} 
                disabled={saving || editedContents[item.key] === item.value}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {contents.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No content items found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}