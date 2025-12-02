import { Palette, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useThemeCustomizer } from "@/hooks/use-theme-customizer";

const hslToHex = (hsl: string): string => {
  const [h, s, l] = hsl.split(" ").map((v) => parseFloat(v));
  const hDecimal = h / 360;
  const sDecimal = s / 100;
  const lDecimal = l / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (sDecimal === 0) {
    r = g = b = lDecimal;
  } else {
    const q =
      lDecimal < 0.5
        ? lDecimal * (1 + sDecimal)
        : lDecimal + sDecimal - lDecimal * sDecimal;
    const p = 2 * lDecimal - q;
    r = hue2rgb(p, q, hDecimal + 1 / 3);
    g = hue2rgb(p, q, hDecimal);
    b = hue2rgb(p, q, hDecimal - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const hexToHsl = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "200 98% 39%";

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

export function ThemeCustomizer() {
  const { colors, updateColor, resetToDefault, isDefault } =
    useThemeCustomizer();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Palette className="h-4 w-4" />
          {!isDefault && (
            <span className="absolute -top-1 -right-1 h-2 w-2 bg-primary rounded-full" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Customize Theme</h4>
            {!isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetToDefault}
                className="h-8 px-2"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="primary" className="text-xs">
                Primary Color
              </Label>
              <div className="flex gap-2">
                <Input
                  id="primary"
                  type="color"
                  value={hslToHex(colors.primary)}
                  onChange={(e) =>
                    updateColor("primary", hexToHsl(e.target.value))
                  }
                  className="h-10 w-16 cursor-pointer"
                />
                <Input
                  type="text"
                  value={colors.primary}
                  onChange={(e) => updateColor("primary", e.target.value)}
                  className="h-10 flex-1 font-mono text-xs"
                  placeholder="200 98% 39%"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="primary-glow" className="text-xs">
                Primary Glow
              </Label>
              <div className="flex gap-2">
                <Input
                  id="primary-glow"
                  type="color"
                  value={hslToHex(colors.primaryGlow)}
                  onChange={(e) =>
                    updateColor("primaryGlow", hexToHsl(e.target.value))
                  }
                  className="h-10 w-16 cursor-pointer"
                />
                <Input
                  type="text"
                  value={colors.primaryGlow}
                  onChange={(e) => updateColor("primaryGlow", e.target.value)}
                  className="h-10 flex-1 font-mono text-xs"
                  placeholder="210 85% 45%"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accent" className="text-xs">
                Accent Color
              </Label>
              <div className="flex gap-2">
                <Input
                  id="accent"
                  type="color"
                  value={hslToHex(colors.accent)}
                  onChange={(e) =>
                    updateColor("accent", hexToHsl(e.target.value))
                  }
                  className="h-10 w-16 cursor-pointer"
                />
                <Input
                  type="text"
                  value={colors.accent}
                  onChange={(e) => updateColor("accent", e.target.value)}
                  className="h-10 flex-1 font-mono text-xs"
                  placeholder="210 40% 98%"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sidebar-bg" className="text-xs">
                Sidebar Background
              </Label>
              <div className="flex gap-2">
                <Input
                  id="sidebar-bg"
                  type="color"
                  value={hslToHex(colors.sidebarBackground)}
                  onChange={(e) =>
                    updateColor("sidebarBackground", hexToHsl(e.target.value))
                  }
                  className="h-10 w-16 cursor-pointer"
                />
                <Input
                  type="text"
                  value={colors.sidebarBackground}
                  onChange={(e) => updateColor("sidebarBackground", e.target.value)}
                  className="h-10 flex-1 font-mono text-xs"
                  placeholder="0 0% 98%"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Default: Deep Ocean Blue theme. Colors are saved automatically.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
