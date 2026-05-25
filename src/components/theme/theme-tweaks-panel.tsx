"use client"

import { Palette, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  ACCENT_SWATCHES,
  type BgTone,
  type ColorMode,
  type Density,
  type FontFamilyId,
  type RadiusScale,
  type SidebarMode,
} from "@/lib/theme-tokens"
import { useThemeTokens } from "./theme-tokens-provider"
import { useUiTheme } from "@/components/beta/ui-theme-provider"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ThemeTweaksPanel({ open, onOpenChange }: Props) {
  const { tokens, patchTokens, resetTokens } = useThemeTokens()
  const { theme: shellTheme, setTheme: setShellTheme } = useUiTheme()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Design-Tweaks
          </SheetTitle>
          <SheetDescription>
            Live-Anpassung (EDITMODE). Werte werden in{" "}
            <code className="rounded bg-muted px-1 text-xs">simplecrm:themeTokens</code> gespeichert.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 pb-8">
            <section className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Oberfläche
              </Label>
              <Segmented
                value={shellTheme}
                options={[
                  { id: "classic", label: "Klassisch" },
                  { id: "beta", label: "Beta v0.2" },
                ]}
                onChange={(v) => setShellTheme(v)}
              />
            </section>

            <section className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Farbmodus
              </Label>
              <Segmented<ColorMode>
                value={tokens.colorMode}
                options={[
                  { id: "dark", label: "Dunkel" },
                  { id: "light", label: "Hell" },
                ]}
                onChange={(v) => patchTokens({ colorMode: v })}
              />
            </section>

            <section className="space-y-2">
              <Label>Hintergrundton</Label>
              <Segmented<BgTone>
                value={tokens.bgTone}
                options={[
                  { id: "cool", label: "Kühl" },
                  { id: "neutral", label: "Neutral" },
                  { id: "warm", label: "Warm" },
                ]}
                onChange={(v) => patchTokens({ bgTone: v })}
              />
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Akzent-Farbton ({Math.round(tokens.accentHue)}°)</Label>
              </div>
              <Slider
                min={0}
                max={360}
                step={1}
                value={[tokens.accentHue]}
                onValueChange={([v]) => patchTokens({ accentHue: v ?? 75 })}
              />
              <div className="flex flex-wrap gap-2">
                {ACCENT_SWATCHES.map((s) => (
                  <button
                    key={s.hue}
                    type="button"
                    title={s.label}
                    onClick={() => patchTokens({ accentHue: s.hue })}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                      tokens.accentHue === s.hue ? "border-foreground" : "border-transparent",
                    )}
                    style={{
                      background: `oklch(0.72 ${tokens.accentChroma} ${s.hue})`,
                    }}
                  />
                ))}
              </div>
              <Label className="text-xs text-muted-foreground">
                Sättigung (Chroma) {(tokens.accentChroma * 100).toFixed(0)}%
              </Label>
              <Slider
                min={0.05}
                max={0.28}
                step={0.01}
                value={[tokens.accentChroma]}
                onValueChange={([v]) => patchTokens({ accentChroma: v ?? 0.18 })}
              />
            </section>

            <section className="space-y-2">
              <Label>Dichte</Label>
              <Segmented<Density>
                value={tokens.density}
                options={[
                  { id: "compact", label: "Kompakt" },
                  { id: "comfort", label: "Komfort" },
                  { id: "cozy", label: "Cozy" },
                ]}
                onChange={(v) => patchTokens({ density: v })}
              />
            </section>

            <section className="space-y-2">
              <Label>Eckenradius</Label>
              <Segmented<RadiusScale>
                value={tokens.radius}
                options={[
                  { id: "sharp", label: "Scharf" },
                  { id: "medium", label: "Mittel" },
                  { id: "pill", label: "Pill" },
                ]}
                onChange={(v) => patchTokens({ radius: v })}
              />
            </section>

            <section className="space-y-2">
              <Label>Sidebar</Label>
              <Segmented<SidebarMode>
                value={tokens.sidebarMode}
                options={[
                  { id: "rail", label: "Schmal" },
                  { id: "full", label: "Voll" },
                ]}
                onChange={(v) => patchTokens({ sidebarMode: v })}
              />
            </section>

            <section className="space-y-2">
              <Label htmlFor="font-family">Schriftart</Label>
              <select
                id="font-family"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={tokens.fontFamily}
                onChange={(e) =>
                  patchTokens({ fontFamily: e.target.value as FontFamilyId })
                }
              >
                <option value="geist">Geist</option>
                <option value="inter-tight">Inter Tight</option>
                <option value="ibm-plex">IBM Plex Sans</option>
                <option value="space-grotesk">Space Grotesk</option>
              </select>
            </section>
          </div>
        </ScrollArea>
        <div className="flex gap-2 border-t pt-4">
          <Button type="button" variant="outline" className="flex-1 gap-2" onClick={resetTokens}>
            <RotateCcw className="h-4 w-4" />
            Zurücksetzen
          </Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
