import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminTheme } from '@/contexts/AdminThemeContext';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { toast } from 'sonner';
import { Palette, Save, RotateCcw, Eye } from 'lucide-react';

export default function ThemeSettings() {
  const { backgroundColor, setBackgroundColor, saveBackgroundColor, isLoading } = useAdminTheme();
  const { permissions } = useAdminPermissions();
  const [previewColor, setPreviewColor] = useState(backgroundColor);
  const [hexInput, setHexInput] = useState(backgroundColor);
  const [isSaving, setIsSaving] = useState(false);
  const [originalColor, setOriginalColor] = useState(backgroundColor);

  // Sync with loaded background color
  useEffect(() => {
    if (!isLoading) {
      setPreviewColor(backgroundColor);
      setHexInput(backgroundColor);
      setOriginalColor(backgroundColor);
    }
  }, [backgroundColor, isLoading]);

  // Check if user is super admin
  const isSuperAdmin = permissions?.role === 'super_admin';

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Palette className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">
              Only Super Admins can access Theme Settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleColorChange = (color: string) => {
    setPreviewColor(color);
    setHexInput(color);
    // Apply live preview
    setBackgroundColor(color);
  };

  const handleHexInputChange = (value: string) => {
    setHexInput(value);
    // Validate hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      setPreviewColor(value);
      setBackgroundColor(value);
    }
  };

  const handleSave = async () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(previewColor)) {
      toast.error('Invalid color format. Please use a valid hex color.');
      return;
    }

    setIsSaving(true);
    const success = await saveBackgroundColor(previewColor);
    setIsSaving(false);

    if (success) {
      setOriginalColor(previewColor);
      toast.success('Theme settings saved successfully!');
    } else {
      toast.error('Failed to save theme settings. Please try again.');
    }
  };

  const handleReset = () => {
    setPreviewColor(originalColor);
    setHexInput(originalColor);
    setBackgroundColor(originalColor);
  };

  const handleResetToDefault = () => {
    const defaultColor = '#0a0a0a';
    setPreviewColor(defaultColor);
    setHexInput(defaultColor);
    setBackgroundColor(defaultColor);
  };

  // Convert hex to RGB for display
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  };

  const rgb = hexToRgb(previewColor);
  const hasChanges = previewColor !== originalColor;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Theme Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the admin portal appearance
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Color Picker Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Background Color</CardTitle>
            </div>
            <CardDescription>
              Set the main background color for the admin dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Color Picker */}
            <div className="space-y-3">
              <Label htmlFor="color-picker">Select Color</Label>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <input
                    id="color-picker"
                    type="color"
                    value={previewColor}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className="w-20 h-20 rounded-lg cursor-pointer border-2 border-border/50 bg-transparent"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <Label htmlFor="hex-input" className="text-xs text-muted-foreground">
                      Hex Value
                    </Label>
                    <Input
                      id="hex-input"
                      value={hexInput}
                      onChange={(e) => handleHexInputChange(e.target.value)}
                      placeholder="#000000"
                      className="font-mono"
                    />
                  </div>
                  {rgb && (
                    <p className="text-xs text-muted-foreground">
                      RGB: {rgb.r}, {rgb.g}, {rgb.b}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="space-y-3">
              <Label className="text-sm">Quick Presets</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { color: '#0a0a0a', name: 'Default Dark' },
                  { color: '#0D1117', name: 'GitHub Dark' },
                  { color: '#1a1a2e', name: 'Deep Blue' },
                  { color: '#0f172a', name: 'Slate' },
                  { color: '#18181b', name: 'Zinc' },
                  { color: '#1c1917', name: 'Stone' },
                ].map((preset) => (
                  <button
                    key={preset.color}
                    onClick={() => handleColorChange(preset.color)}
                    className="group flex flex-col items-center gap-1"
                  >
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-border/50 hover:border-primary transition-colors"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      {preset.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4 border-t border-border/50">
              <Button
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!hasChanges}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              <Button
                variant="ghost"
                onClick={handleResetToDefault}
                className="gap-2 text-muted-foreground"
              >
                Reset to Default
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Live Preview</CardTitle>
            </div>
            <CardDescription>
              See how the selected color looks on the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-lg border border-border/50 overflow-hidden h-64"
              style={{ backgroundColor: previewColor }}
            >
              {/* Mini Dashboard Preview */}
              <div className="p-4 h-full">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="h-6 w-32 bg-white/10 rounded" />
                  <div className="h-6 w-20 bg-white/10 rounded" />
                </div>
                {/* Cards */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-16 bg-white/5 rounded-lg border border-white/10 p-2">
                      <div className="h-2 w-12 bg-white/20 rounded mb-2" />
                      <div className="h-4 w-8 bg-white/30 rounded" />
                    </div>
                  ))}
                </div>
                {/* Chart placeholder */}
                <div className="h-20 bg-white/5 rounded-lg border border-white/10" />
              </div>
            </div>
            
            {hasChanges && (
              <p className="text-sm text-yellow-500 mt-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                Unsaved changes - click Save to apply
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
