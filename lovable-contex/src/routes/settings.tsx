import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ChevronDown, Sun, Moon } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Pipeline Pro" }] }),
});

function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings">
        <button className="px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-white/5 text-muted-foreground">
          Reset
        </button>
        <button className="px-5 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-lg ring-2 ring-primary/20 shadow-lg shadow-primary/20 hover:brightness-110">
          Save
        </button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <Section
            title="Appearance"
            description="How Pipeline Pro looks on this machine."
            defaultOpen
          >
            <ThemeRow />
            <Row label="Canvas background" hint="Default color behind images in the editor.">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded border border-border bg-[hsl(40_8%_96%)]" />
                <input
                  defaultValue="#F5F5F1"
                  className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-28 outline-none focus:border-primary/40"
                />
              </div>
            </Row>
            <SliderRow label="Guide opacity" value={70} />
            <SliderRow label="Reference image opacity" value={5} />
          </Section>

          <Section
            title="Input / Output defaults"
            description="Defaults applied to every new session."
            defaultOpen
          >
            <Row label="Default input folder">
              <input
                placeholder="blank = ./input"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-72 outline-none focus:border-primary/40"
              />
            </Row>
            <Row label="Default output folder">
              <input
                placeholder="blank = ./output"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-72 outline-none focus:border-primary/40"
              />
            </Row>
            <Row label="Canvas size (px)">
              <input
                defaultValue="1440"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-24 outline-none focus:border-primary/40"
              />
            </Row>
            <ToggleRow label="Thumbnail" hint="Generate resized preview on save." defaultOn />
            <Row label="Thumbnail size (px)">
              <input
                defaultValue="400"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-24 outline-none focus:border-primary/40"
              />
            </Row>
            <SelectRow label="Folder mode" value="Bulk — flat folder" />
            <ToggleRow label="Default upscale" defaultOn />
            <ToggleRow label="Default remove BG" defaultOn />
            <SelectRow label="Default upscale factor" value="2×" />
          </Section>

          <Section
            title="Background removal"
            description="Advanced segmentation tuning."
          >
            <SelectRow label="Model" value="bria-rmbg" />
            <ToggleRow label="Force CPU" hint="Disables GPU acceleration." />
            <Row label="Crop padding">
              <input
                defaultValue="12"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-20 outline-none"
              />
            </Row>
            <Row label="Edge blur">
              <input
                defaultValue="0.5"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-20 outline-none"
              />
            </Row>
            <Row label="History folders to keep">
              <input
                defaultValue="5"
                className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-20 outline-none"
              />
            </Row>
            <ToggleRow label="Wipe input after run" hint="Move processed files out of the input folder." />
          </Section>

          <Section title="Upscaling rules" description="When to skip upscaling.">
            <Row label="Skip upscale if any side ≥">
              <div className="flex items-center gap-2">
                <input
                  placeholder="no skip"
                  className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-24 outline-none"
                />
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  px
                </span>
              </div>
            </Row>
          </Section>

          <Section title="Guides" description="Custom guide coordinates as percentages.">
            <Row label="Green zone (top, bottom)">
              <div className="flex gap-2">
                <input defaultValue="8" className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-16 outline-none" />
                <input defaultValue="92" className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-16 outline-none" />
              </div>
            </Row>
            <Row label="Blue zone (left, right)">
              <div className="flex gap-2">
                <input defaultValue="20" className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-16 outline-none" />
                <input defaultValue="80" className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-16 outline-none" />
              </div>
            </Row>
          </Section>

          <Section title="GPU setup" description="How to enable hardware acceleration.">
            <div className="text-xs text-muted-foreground leading-relaxed bg-black/20 border border-border rounded-lg p-4">
              Pipeline Pro auto-detects Vulkan-capable GPUs for NCNN upscaling.
              If your card isn't detected, install the latest vendor drivers and
              relaunch. Force CPU above if you experience instability.
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02]"
      >
        <div className="text-left">
          <h3 className="text-sm font-bold text-foreground tracking-tight">{title}</h3>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <ChevronDown
          className={[
            "size-4 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-border animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2 gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  defaultOn = false,
}: {
  label: string;
  hint?: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <Row label={label} hint={hint}>
      <button
        onClick={() => setOn((v) => !v)}
        className={[
          "w-9 h-5 rounded-full relative transition-colors",
          on ? "bg-primary" : "bg-white/10",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 size-3 rounded-full bg-white transition-all",
            on ? "left-5" : "left-1",
          ].join(" ")}
        />
      </button>
    </Row>
  );
}

function SliderRow({ label, value }: { label: string; value: number }) {
  const [v, setV] = useState(value);
  return (
    <Row label={label}>
      <div className="flex items-center gap-3 w-72">
        <input
          type="range"
          min={0}
          max={100}
          value={v}
          onChange={(e) => setV(parseInt(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="text-[11px] font-mono w-10 text-right text-foreground">
          {v}%
        </span>
      </div>
    </Row>
  );
}

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label}>
      <button className="bg-black/30 border border-border rounded-md px-3 py-1.5 text-xs font-mono w-56 inline-flex items-center justify-between hover:bg-black/40">
        <span>{value}</span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
    </Row>
  );
}

function ThemeRow() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const apply = (t: "dark" | "light") => {
    setTheme(t);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("light", t === "light");
    }
  };

  return (
    <Row label="Theme" hint="Switch between darkroom and studio modes.">
      <div className="flex gap-1 p-1 bg-black/30 border border-border rounded-lg">
        <button
          onClick={() => apply("dark")}
          className={[
            "px-3 py-1.5 text-[11px] font-medium rounded-md inline-flex items-center gap-1.5",
            theme === "dark" ? "bg-white/10 text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <Moon className="size-3" /> Dark
        </button>
        <button
          onClick={() => apply("light")}
          className={[
            "px-3 py-1.5 text-[11px] font-medium rounded-md inline-flex items-center gap-1.5",
            theme === "light" ? "bg-white/10 text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <Sun className="size-3" /> Light
        </button>
      </div>
    </Row>
  );
}
