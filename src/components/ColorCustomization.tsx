import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Palette, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type ThemeMode = 'default' | 'soft-light' | 'dark' | 'darker' | 'high-contrast' | 'custom';

const presetThemes = {
  default: {
    primary: '210 100% 55%',
    secondary: '160 80% 45%',
    background: '0 0% 100%',
    foreground: '220 20% 10%',
  },
  'soft-light': {
    primary: '200 80% 60%',
    secondary: '150 60% 55%',
    background: '210 40% 98%',
    foreground: '220 20% 15%',
  },
  dark: {
    primary: '210 100% 60%',
    secondary: '160 80% 50%',
    background: '220 25% 8%',
    foreground: '210 40% 98%',
  },
  darker: {
    primary: '210 100% 65%',
    secondary: '160 80% 55%',
    background: '220 30% 4%',
    foreground: '210 40% 98%',
  },
  'high-contrast': {
    primary: '220 100% 50%',
    secondary: '140 100% 40%',
    background: '0 0% 100%',
    foreground: '0 0% 0%',
  },
};

export function ColorCustomization() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('default');
  const [customHue, setCustomHue] = useState(210);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('themeMode') as ThemeMode;
    const savedHue = localStorage.getItem('customHue');
    
    if (saved) {
      setThemeMode(saved);
      if (saved === 'custom' && savedHue) {
        setCustomHue(parseInt(savedHue));
        applyCustomColor(parseInt(savedHue));
      } else if (saved !== 'custom') {
        applyPresetTheme(saved);
      }
    }
  }, []);

  const applyPresetTheme = (mode: Exclude<ThemeMode, 'custom'>) => {
    const theme = presetThemes[mode];
    const root = document.documentElement;
    
    // Apply colors
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--secondary', theme.secondary);
    root.style.setProperty('--accent', theme.primary);
    root.style.setProperty('--gradient-start', theme.primary);
    root.style.setProperty('--gradient-end', theme.secondary);
    root.style.setProperty('--ring', theme.primary);
    root.style.setProperty('--sidebar-primary', theme.primary);
    root.style.setProperty('--sidebar-ring', theme.primary);
    root.style.setProperty('--shadow-glow', theme.primary);
    
    // Apply background and foreground
    root.style.setProperty('--background', theme.background);
    root.style.setProperty('--foreground', theme.foreground);
    
    // Update dark mode class
    if (mode === 'dark' || mode === 'darker') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const applyCustomColor = (hue: number) => {
    const root = document.documentElement;
    const isDark = document.documentElement.classList.contains('dark');
    
    const lightness = isDark ? '60%' : '55%';
    const saturation = '100%';
    
    const primaryColor = `${hue} ${saturation} ${lightness}`;
    const secondaryHue = (hue + 140) % 360;
    const secondaryColor = `${secondaryHue} 80% ${isDark ? '50%' : '45%'}`;
    
    root.style.setProperty('--primary', primaryColor);
    root.style.setProperty('--secondary', secondaryColor);
    root.style.setProperty('--accent', primaryColor);
    root.style.setProperty('--gradient-start', primaryColor);
    root.style.setProperty('--gradient-end', secondaryColor);
    root.style.setProperty('--ring', primaryColor);
    root.style.setProperty('--sidebar-primary', primaryColor);
    root.style.setProperty('--sidebar-ring', primaryColor);
    root.style.setProperty('--shadow-glow', primaryColor);
  };

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem('themeMode', mode);
    
    if (mode !== 'custom') {
      applyPresetTheme(mode);
    } else {
      applyCustomColor(customHue);
    }
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hue = parseInt(e.target.value);
    setCustomHue(hue);
    localStorage.setItem('customHue', hue.toString());
    applyCustomColor(hue);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Palette className="h-4 w-4" />
          <span className="hidden sm:inline">Theme</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Display Preferences
          </SheetTitle>
          <SheetDescription>
            Customize the colors to match your eye comfort and preference
          </SheetDescription>
        </SheetHeader>
        
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Preset Themes</CardTitle>
              <CardDescription>Choose from pre-configured color schemes</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup value={themeMode} onValueChange={(v) => handleThemeChange(v as ThemeMode)}>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="default" id="default" />
                    <Label htmlFor="default" className="cursor-pointer flex-1">
                      Default (Electric Blue)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="soft-light" id="soft-light" />
                    <Label htmlFor="soft-light" className="cursor-pointer flex-1">
                      Soft Light (Calm Sky)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dark" id="dark" />
                    <Label htmlFor="dark" className="cursor-pointer flex-1">
                      Dark Mode (Deep Ocean)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="darker" id="darker" />
                    <Label htmlFor="darker" className="cursor-pointer flex-1">
                      Darker Mode (Midnight Black)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="high-contrast" id="high-contrast" />
                    <Label htmlFor="high-contrast" className="cursor-pointer flex-1">
                      High Contrast (Bold)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="custom" id="custom" />
                    <Label htmlFor="custom" className="cursor-pointer flex-1">
                      Custom Color Wheel
                    </Label>
                  </div>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {themeMode === 'custom' && (
            <Card className="animate-scale-in">
              <CardHeader>
                <CardTitle>Custom Color Selector</CardTitle>
                <CardDescription>Drag to select your preferred accent color</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <div className="flex items-center justify-center">
                    <div className="relative w-48 h-48 rounded-full" style={{
                      background: `conic-gradient(
                        hsl(0, 100%, 55%),
                        hsl(60, 100%, 55%),
                        hsl(120, 100%, 55%),
                        hsl(180, 100%, 55%),
                        hsl(240, 100%, 55%),
                        hsl(300, 100%, 55%),
                        hsl(360, 100%, 55%)
                      )`
                    }}>
                      <div 
                        className="absolute w-6 h-6 rounded-full border-4 border-white shadow-lg cursor-pointer transition-transform hover:scale-110"
                        style={{
                          backgroundColor: `hsl(${customHue}, 100%, 55%)`,
                          top: '50%',
                          left: '50%',
                          transform: `translate(-50%, -50%) rotate(${customHue}deg) translateY(-80px)`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="hue-slider">Hue: {customHue}°</Label>
                  <input
                    id="hue-slider"
                    type="range"
                    min="0"
                    max="360"
                    value={customHue}
                    onChange={handleColorChange}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right,
                        hsl(0, 100%, 55%),
                        hsl(60, 100%, 55%),
                        hsl(120, 100%, 55%),
                        hsl(180, 100%, 55%),
                        hsl(240, 100%, 55%),
                        hsl(300, 100%, 55%),
                        hsl(360, 100%, 55%)
                      )`
                    }}
                  />
                </div>

                <div className="pt-4 border-t">
                  <div className="text-sm text-muted-foreground mb-2">Preview</div>
                  <div className="flex gap-2">
                    <div 
                      className="flex-1 h-20 rounded-lg border shadow-sm flex items-center justify-center text-white font-semibold"
                      style={{ backgroundColor: `hsl(${customHue}, 100%, 55%)` }}
                    >
                      Primary
                    </div>
                    <div 
                      className="flex-1 h-20 rounded-lg border shadow-sm flex items-center justify-center text-white font-semibold"
                      style={{ backgroundColor: `hsl(${(customHue + 140) % 360}, 80%, 45%)` }}
                    >
                      Accent
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
