import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAdminTheme, AdminThemeSettings, THEME_PRESETS, ThemePreset } from '@/contexts/AdminThemeContext';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { toast } from 'sonner';
import { Palette, Save, RotateCcw, Eye, Sun, Moon, Square, Sidebar, Sparkles } from 'lucide-react';

const PRESET_INFO: Record<ThemePreset, { label: string; description: string }> = {
  DefaultDark: { label: 'Default Dark', description: 'Classic dark theme with blue accents' },
  DefaultLight: { label: 'Default Light', description: 'Clean light theme for daytime use' },
  BlueAccent: { label: 'GitHub Dark', description: 'GitHub-inspired dark with bright blue' },
  PurpleAccent: { label: 'Purple Night', description: 'Deep purple with violet accents' },
  Custom: { label: 'Custom', description: 'Your personalized theme settings' },
};

export default function ThemeSettings() {
  const { theme, setTheme, applyPreset, saveTheme, resetToDefaults, hasChanges } = useAdminTheme();
  const { permissions } = useAdminPermissions();
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSave = async () => {
    setIsSaving(true);
    const success = await saveTheme();
    setIsSaving(false);

    if (success) {
      toast.success('Theme settings saved successfully!');
    } else {
      toast.error('Failed to save theme settings. Please try again.');
    }
  };

  const handleColorChange = (key: keyof AdminThemeSettings, value: string) => {
    setTheme({ [key]: value });
  };

  const colorPresets = {
    dark: [
      { color: '#0a0a0a', name: 'Default' },
      { color: '#0D1117', name: 'GitHub' },
      { color: '#1a1a2e', name: 'Deep Blue' },
      { color: '#0f172a', name: 'Slate' },
      { color: '#18181b', name: 'Zinc' },
      { color: '#1c1917', name: 'Stone' },
    ],
    light: [
      { color: '#ffffff', name: 'White' },
      { color: '#f8fafc', name: 'Slate' },
      { color: '#fafafa', name: 'Neutral' },
      { color: '#fafaf9', name: 'Stone' },
      { color: '#f0fdf4', name: 'Green' },
      { color: '#eff6ff', name: 'Blue' },
    ],
  };

  const accentPresets = [
    { color: '#3b82f6', name: 'Blue' },
    { color: '#8b5cf6', name: 'Violet' },
    { color: '#ec4899', name: 'Pink' },
    { color: '#f97316', name: 'Orange' },
    { color: '#10b981', name: 'Emerald' },
    { color: '#06b6d4', name: 'Cyan' },
  ];

  const borderRadiusOptions = [
    { value: 'none', label: 'None', preview: 'rounded-none' },
    { value: 'sm', label: 'Small', preview: 'rounded-sm' },
    { value: 'md', label: 'Medium', preview: 'rounded-md' },
    { value: 'lg', label: 'Large', preview: 'rounded-lg' },
    { value: 'xl', label: 'Extra Large', preview: 'rounded-xl' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Theme Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize the admin portal appearance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={resetToDefaults}
            disabled={!hasChanges}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          <span className="text-sm text-yellow-600 dark:text-yellow-400">
            You have unsaved changes
          </span>
        </div>
      )}

      {/* Theme Presets */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Theme Presets</CardTitle>
          </div>
          <CardDescription>
            Quick start with a preset or customize your own
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((preset) => {
              const presetValues = THEME_PRESETS[preset];
              const info = PRESET_INFO[preset];
              const isActive = theme.activePreset === preset;
              
              return (
                <button
                  key={preset}
                  onClick={() => applyPreset(preset)}
                  className={`group relative p-3 rounded-lg border-2 transition-all text-left ${
                    isActive 
                      ? 'border-primary bg-primary/10' 
                      : 'border-border/50 hover:border-border bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  {/* Color preview squares */}
                  <div className="flex gap-1 mb-2">
                    <div 
                      className="w-5 h-5 rounded border border-white/20" 
                      style={{ backgroundColor: presetValues.backgroundColor }}
                      title="Background"
                    />
                    <div 
                      className="w-5 h-5 rounded border border-white/20" 
                      style={{ backgroundColor: presetValues.sidebarColor }}
                      title="Sidebar"
                    />
                    <div 
                      className="w-5 h-5 rounded border border-white/20" 
                      style={{ backgroundColor: presetValues.accentColor }}
                      title="Accent"
                    />
                  </div>
                  <span className="text-sm font-medium block">{info.label}</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">{info.description}</span>
                  {isActive && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column - Settings */}
        <div className="space-y-6">
          {/* Light/Dark Mode Toggle */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                {theme.mode === 'dark' ? (
                  <Moon className="h-5 w-5 text-primary" />
                ) : (
                  <Sun className="h-5 w-5 text-primary" />
                )}
                <CardTitle className="text-lg">Appearance Mode</CardTitle>
              </div>
              <CardDescription>
                Switch between light and dark color schemes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <Sun className="h-5 w-5 text-yellow-500" />
                  <span className="font-medium">Light Mode</span>
                </div>
                <Switch
                  checked={theme.mode === 'dark'}
                  onCheckedChange={(checked) => setTheme({ mode: checked ? 'dark' : 'light' })}
                />
                <div className="flex items-center gap-3">
                  <span className="font-medium">Dark Mode</span>
                  <Moon className="h-5 w-5 text-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Background Color */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Background Color</CardTitle>
              </div>
              <CardDescription>Main dashboard background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <input
                  type="color"
                  value={theme.backgroundColor}
                  onChange={(e) => handleColorChange('backgroundColor', e.target.value)}
                  className="w-16 h-16 rounded-lg cursor-pointer border-2 border-border/50 bg-transparent"
                />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Hex Value</Label>
                  <Input
                    value={theme.backgroundColor}
                    onChange={(e) => handleColorChange('backgroundColor', e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {colorPresets[theme.mode].map((preset) => (
                  <button
                    key={preset.color}
                    onClick={() => handleColorChange('backgroundColor', preset.color)}
                    className="group flex flex-col items-center gap-1"
                    title={preset.name}
                  >
                    <div
                      className="w-8 h-8 rounded-lg border-2 border-border/50 hover:border-primary transition-colors"
                      style={{ backgroundColor: preset.color }}
                    />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sidebar Color */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Sidebar className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Sidebar Color</CardTitle>
              </div>
              <CardDescription>Navigation sidebar background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <input
                  type="color"
                  value={theme.sidebarColor}
                  onChange={(e) => handleColorChange('sidebarColor', e.target.value)}
                  className="w-16 h-16 rounded-lg cursor-pointer border-2 border-border/50 bg-transparent"
                />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Hex Value</Label>
                  <Input
                    value={theme.sidebarColor}
                    onChange={(e) => handleColorChange('sidebarColor', e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Accent Color */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Square className="h-5 w-5 text-primary" fill="currentColor" />
                <CardTitle className="text-lg">Accent Color</CardTitle>
              </div>
              <CardDescription>Primary accent for buttons and highlights</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <input
                  type="color"
                  value={theme.accentColor}
                  onChange={(e) => handleColorChange('accentColor', e.target.value)}
                  className="w-16 h-16 rounded-lg cursor-pointer border-2 border-border/50 bg-transparent"
                />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Hex Value</Label>
                  <Input
                    value={theme.accentColor}
                    onChange={(e) => handleColorChange('accentColor', e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {accentPresets.map((preset) => (
                  <button
                    key={preset.color}
                    onClick={() => handleColorChange('accentColor', preset.color)}
                    className="group flex flex-col items-center gap-1"
                    title={preset.name}
                  >
                    <div
                      className="w-8 h-8 rounded-lg border-2 border-border/50 hover:border-primary transition-colors"
                      style={{ backgroundColor: preset.color }}
                    />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Border Radius */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Border Radius</CardTitle>
              <CardDescription>Roundness of cards and buttons</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={theme.borderRadius}
                onValueChange={(value) => setTheme({ borderRadius: value as AdminThemeSettings['borderRadius'] })}
                className="grid grid-cols-5 gap-3"
              >
                {borderRadiusOptions.map((option) => (
                  <Label
                    key={option.value}
                    className="flex flex-col items-center gap-2 cursor-pointer"
                  >
                    <div
                      className={`w-12 h-12 border-2 ${option.preview} ${
                        theme.borderRadius === option.value 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border/50 bg-muted/30'
                      } transition-colors`}
                    />
                    <div className="flex items-center gap-1">
                      <RadioGroupItem value={option.value} className="sr-only" />
                      <span className="text-xs">{option.label}</span>
                    </div>
                  </Label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Live Preview</CardTitle>
              </div>
              <CardDescription>
                See how your theme looks in real-time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="rounded-lg border border-border/50 overflow-hidden"
                style={{ 
                  backgroundColor: theme.backgroundColor,
                  borderRadius: `var(--admin-radius, 0.5rem)`,
                }}
              >
                {/* Mini Dashboard Preview */}
                <div className="flex h-80">
                  {/* Sidebar Preview */}
                  <div 
                    className="w-16 border-r border-white/10 p-2 space-y-2"
                    style={{ backgroundColor: theme.sidebarColor }}
                  >
                    <div className="h-8 w-8 rounded bg-white/10 mx-auto" />
                    <div className="space-y-2 pt-4">
                      {[1, 2, 3, 4].map((i) => (
                        <div 
                          key={i} 
                          className="h-8 w-8 rounded mx-auto"
                          style={{ 
                            backgroundColor: i === 1 ? theme.accentColor : 'rgba(255,255,255,0.1)',
                            borderRadius: `var(--admin-radius, 0.5rem)`,
                          }} 
                        />
                      ))}
                    </div>
                  </div>
                  {/* Content Preview */}
                  <div className="flex-1 p-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="h-5 w-28 bg-white/10 rounded" style={{ borderRadius: `var(--admin-radius, 0.5rem)` }} />
                      <div className="h-5 w-16 bg-white/10 rounded" style={{ borderRadius: `var(--admin-radius, 0.5rem)` }} />
                    </div>
                    {/* Cards */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {[1, 2, 3, 4].map((i) => (
                        <div 
                          key={i} 
                          className="h-14 bg-white/5 border border-white/10 p-2"
                          style={{ borderRadius: `var(--admin-radius, 0.5rem)` }}
                        >
                          <div className="h-2 w-10 bg-white/20 rounded mb-2" />
                          <div className="h-3 w-6 bg-white/30 rounded" />
                        </div>
                      ))}
                    </div>
                    {/* Chart placeholder */}
                    <div 
                      className="h-24 bg-white/5 border border-white/10"
                      style={{ borderRadius: `var(--admin-radius, 0.5rem)` }}
                    />
                    {/* Button preview */}
                    <div className="flex gap-2 mt-3">
                      <div 
                        className="h-7 w-16 flex items-center justify-center text-xs text-white"
                        style={{ 
                          backgroundColor: theme.accentColor,
                          borderRadius: `var(--admin-radius, 0.5rem)`,
                        }}
                      >
                        Button
                      </div>
                      <div 
                        className="h-7 w-16 bg-white/10 border border-white/20"
                        style={{ borderRadius: `var(--admin-radius, 0.5rem)` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
