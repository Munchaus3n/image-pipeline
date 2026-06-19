import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  Save,
  SkipForward,
  FolderOpen,
  RotateCcw,
  Trash2,
  Layers,
  ChevronDown,
} from "lucide-react";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
  head: () => ({ meta: [{ title: "Editor — Pipeline Pro" }] }),
});

const ZONES = [
  { id: "g", color: "hsl(142 70% 45%)", label: "G" },
  { id: "b", color: "hsl(235 85% 65%)", label: "B" },
  { id: "m", color: "hsl(310 85% 65%)", label: "M" },
  { id: "r", color: "hsl(0 85% 60%)", label: "R" },
] as const;

function EditorPage() {
  const [zone, setZone] = useState<string>("b");
  const [scale, setScale] = useState(0.4);
  const [combo, setCombo] = useState(false);

  return (
    <>
      <PageHeader title="Editor · Place & Save">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span className="px-2 py-1 rounded bg-white/5 border border-border">1 / 4</span>
          <span className="hidden md:inline truncate max-w-xs">123-2.png</span>
        </div>
        <button className="px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-white/5 inline-flex items-center gap-1.5 text-muted-foreground">
          <SkipForward className="size-3.5" /> Skip
        </button>
        <button className="px-5 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-lg ring-2 ring-primary/20 shadow-lg shadow-primary/20 inline-flex items-center gap-2 hover:brightness-110">
          <Save className="size-3.5" /> Save & Next
        </button>
      </PageHeader>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <section className="flex-1 grid place-items-center bg-background p-8 overflow-auto">
          <div
            className="relative aspect-square w-full max-w-[680px] rounded-xl border border-border shadow-2xl overflow-hidden"
            style={{ background: "hsl(40 8% 96%)" }}
          >
            {/* guides */}
            <Guides />
            {/* image */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center"
              style={{
                width: `${scale * 100}%`,
                height: `${scale * 100}%`,
                background:
                  "linear-gradient(160deg, hsl(220 10% 25%), hsl(220 15% 12%))",
                borderRadius: 8,
              }}
            >
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                123-2.png
              </span>
            </div>
            {/* selection ring */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-warning/70 pointer-events-none"
              style={{
                width: `${scale * 100 + 2}%`,
                height: `${scale * 100 + 2}%`,
              }}
            />
          </div>
        </section>

        {/* Right tools */}
        <aside className="w-80 border-l border-border bg-surface/30 flex flex-col shrink-0 overflow-y-auto">
          <ToolGroup title="Source" defaultOpen>
            <button className="w-full px-3 py-2 text-xs border border-border rounded-md hover:bg-white/5 inline-flex items-center justify-center gap-2 text-foreground">
              <FolderOpen className="size-3.5" /> Change source folder
            </button>
            <button className="w-full px-3 py-2 text-xs border border-border rounded-md hover:bg-white/5 inline-flex items-center justify-center gap-2 text-muted-foreground">
              <RotateCcw className="size-3.5" /> Reload
            </button>
            <label className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span className="inline-flex items-center gap-2">
                <Layers className="size-3.5" /> Combo mode
              </span>
              <button
                onClick={() => setCombo((c) => !c)}
                className={[
                  "w-9 h-5 rounded-full relative transition-colors",
                  combo ? "bg-primary" : "bg-white/10",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-1 size-3 rounded-full bg-white transition-all",
                    combo ? "left-5" : "left-1",
                  ].join(" ")}
                />
              </button>
            </label>
          </ToolGroup>

          <ToolGroup title="Template" defaultOpen>
            <button className="w-full p-2.5 bg-black/20 rounded-md border border-border flex items-center justify-between text-xs">
              <span className="font-mono text-foreground/80">— none —</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </ToolGroup>

          <ToolGroup title="Snap & align" defaultOpen>
            <div className="grid grid-cols-4 gap-2">
              {ZONES.map((z) => {
                const active = zone === z.id;
                return (
                  <button
                    key={z.id}
                    onClick={() => setZone(z.id)}
                    className={[
                      "h-9 rounded-md font-bold text-xs border transition",
                      active ? "ring-2 ring-offset-2 ring-offset-surface" : "",
                    ].join(" ")}
                    style={{
                      background: `${z.color}22`,
                      borderColor: `${z.color}66`,
                      color: z.color,
                      // @ts-expect-error css var
                      "--tw-ring-color": z.color,
                    }}
                  >
                    {z.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button className="py-1.5 text-[11px] border border-border rounded-md hover:bg-white/5 text-muted-foreground">
                Fit
              </button>
              <button className="py-1.5 text-[11px] border border-border rounded-md hover:bg-white/5 text-muted-foreground">
                Center H
              </button>
              <button className="py-1.5 text-[11px] border border-border rounded-md hover:bg-white/5 text-muted-foreground">
                Center V
              </button>
            </div>
          </ToolGroup>

          <ToolGroup title="Scale" defaultOpen>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="accent-primary" /> Lock
              </label>
              <span className="font-mono text-foreground">{scale.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.005}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="grid grid-cols-4 gap-1.5">
              {["-5%", "-1%", "+1%", "+5%"].map((l) => (
                <button
                  key={l}
                  className="py-1 text-[10px] font-mono border border-border rounded hover:bg-white/5 text-muted-foreground"
                >
                  {l}
                </button>
              ))}
            </div>
          </ToolGroup>

          <ToolGroup title="Items">
            <div className="px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-[11px] font-mono text-primary">
              123-2.png
            </div>
            <button className="w-full px-3 py-2 text-[11px] border border-error/20 text-error/80 rounded-md hover:bg-error/10 inline-flex items-center justify-center gap-1.5">
              <Trash2 className="size-3" /> Remove item
            </button>
          </ToolGroup>

          <ToolGroup title="Output">
            <button className="w-full px-3 py-2 text-xs border border-border rounded-md hover:bg-white/5 inline-flex items-center justify-center gap-2 text-foreground">
              <FolderOpen className="size-3.5" /> Open output folder
            </button>
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              Saved to <span className="font-mono text-foreground/80">Editor/final</span>.
              Skipped go to <span className="font-mono text-foreground/80">Editor/skipped</span>.
            </p>
          </ToolGroup>
        </aside>
      </div>

      {/* footer hints */}
      <footer className="h-9 border-t border-border bg-surface/50 flex items-center justify-between px-6 text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">
        <div className="flex items-center gap-4">
          <span>Drag = Move</span>
          <span>Scroll = Resize</span>
          <span>Arrows = Nudge</span>
          <span>⌘Z = Undo</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Upscale ✓</span>
          <span>RemBG ✓</span>
          <span className="text-primary">Editor</span>
        </div>
      </footer>
    </>
  );
}

function ToolGroup({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={[
            "size-3.5 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open && <div className="px-5 pb-4 space-y-2 animate-fade-in">{children}</div>}
    </div>
  );
}

function Guides() {
  // 4 nested rectangle guides + center cross
  const rects = [
    { inset: "8%", color: "hsl(142 70% 45% / 0.5)" },
    { inset: "20%", color: "hsl(235 85% 65% / 0.5)" },
    { inset: "32%", color: "hsl(310 85% 65% / 0.5)" },
    { inset: "5%", color: "hsl(0 85% 60% / 0.4)" },
  ];
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            inset: r.inset,
            border: `1px dashed ${r.color}`,
          }}
        />
      ))}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-foreground/10" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-foreground/10" />
      </div>
    </>
  );
}
