import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  Play,
  Square,
  FolderOpen,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Folder,
} from "lucide-react";

export const Route = createFileRoute("/process")({
  component: ProcessPage,
  head: () => ({ meta: [{ title: "Process — Pipeline Pro" }] }),
});

function ProcessPage() {
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<"bulk" | "clean">("bulk");
  const [upscale, setUpscale] = useState(true);
  const [factor, setFactor] = useState<"2x" | "4x">("2x");
  const [skipLarge, setSkipLarge] = useState(true);
  const [bg, setBg] = useState(true);
  const [thumb, setThumb] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);

  return (
    <>
      <PageHeader title="Process · Pipeline">
        {running ? (
          <button
            onClick={() => setRunning(false)}
            className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-error/30 text-error hover:bg-error/10 rounded-md inline-flex items-center gap-1.5"
          >
            <Square className="size-3 fill-current" /> Stop
          </button>
        ) : (
          <button
            onClick={() => setRunning(true)}
            className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-md ring-1 ring-primary/20 shadow shadow-primary/20 inline-flex items-center gap-1.5 hover:brightness-110"
          >
            <Play className="size-3 fill-current" /> Start Batch
          </button>
        )}
      </PageHeader>

      <div className="flex-1 flex overflow-hidden">
        {/* Setup sidebar */}
        <aside className="w-[300px] border-r border-border px-4 py-5 overflow-y-auto space-y-5 bg-surface/30 shrink-0">
          <div>
            <SectionTitle>Mode</SectionTitle>
            <div className="mt-2 flex gap-1 p-1 bg-surface border border-border rounded-md">
              <button
                onClick={() => setMode("bulk")}
                className={[
                  "flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition",
                  mode === "bulk"
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Bulk
              </button>
              <button
                onClick={() => setMode("clean")}
                className={[
                  "flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition",
                  mode === "clean"
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Clean
              </button>
            </div>
          </div>

          <SectionTitle>Environment</SectionTitle>
          <ConfigCard>
            <FolderField label="Source" value="C:/Users/liulis/Downloads/New folder (3)" status="ok" />
            <FolderField label="Output" value="default · ./output" status="default" />
          </ConfigCard>

          <SectionTitle>Enhancement</SectionTitle>
          <ConfigCard>
            <ToggleRow label="Upscale (NCNN)" value={upscale} onChange={setUpscale} />
            <Segmented
              label="Factor"
              value={factor}
              options={["2x", "4x"]}
              onChange={(v) => setFactor(v as "2x" | "4x")}
            />
            <ToggleRow
              label="Skip if side ≥ 1440px"
              hint="Avoid re-upscaling already-large images"
              value={skipLarge}
              onChange={setSkipLarge}
              size="sm"
            />
          </ConfigCard>

          <SectionTitle>Segmentation</SectionTitle>
          <ConfigCard>
            <ToggleRow label="Background removal" value={bg} onChange={setBg} />
            <SelectField label="Model" value="bria-rmbg" />
          </ConfigCard>

          <SectionTitle>Output</SectionTitle>
          <ConfigCard>
            <KVRow k="Canvas size" v="1440 px" />
            <ToggleRow label="Thumbnail (400px)" value={thumb} onChange={setThumb} size="sm" />
          </ConfigCard>

          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Will run
            </p>
            <ul className="space-y-1.5 text-[11px] font-mono">
              {upscale && (
                <li className="text-success flex items-center gap-2">
                  <CheckCircle2 className="size-3" /> Upscale ×{factor === "2x" ? "2" : "4"} (NCNN)
                </li>
              )}
              {bg && (
                <li className="text-success flex items-center gap-2">
                  <CheckCircle2 className="size-3" /> Background removal · bria-rmbg
                </li>
              )}
              {thumb && (
                <li className="text-success flex items-center gap-2">
                  <CheckCircle2 className="size-3" /> Generate thumbnails (400px)
                </li>
              )}
              <li className="text-warning flex items-center gap-2">
                <AlertCircle className="size-3" /> 1 image excluded from BG removal
              </li>
            </ul>
          </div>
        </aside>

        {/* Main */}
        <section className="flex-1 flex flex-col px-6 py-5 overflow-hidden space-y-4 max-w-[1280px] mx-auto w-full">
          {running ? <RunningPanel /> : <SetupPanel />}

          <RecentStream />

          <LogsPanel open={logsOpen} onToggle={() => setLogsOpen((o) => !o)} />
        </section>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
      {children}
    </h2>
  );
}

function ConfigCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card p-4 rounded-xl border border-border shadow-sm space-y-4">
      {children}
    </div>
  );
}

function FolderField({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "ok" | "default";
}) {
  return (
    <div>
      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest block mb-2">
        {label}
      </label>
      <div className="flex items-center gap-2 p-2 bg-black/40 rounded-md border border-border">
        <Folder className="size-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-[11px] font-mono truncate text-foreground/80">
          {value}
        </span>
        <div
          className={[
            "size-2 rounded-full shrink-0",
            status === "ok" ? "bg-success" : "bg-muted",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest block">
        {label}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={[
                "py-2 text-[10px] font-mono uppercase tracking-widest rounded-md border transition",
                active
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:bg-white/5",
              ].join(" ")}
            >
              {o} factor
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p
          className={[
            "font-bold uppercase tracking-widest text-muted-foreground",
            size === "sm" ? "text-[10px]" : "text-[10px]",
          ].join(" ")}
        >
          {label}
        </p>
        {hint && <p className="text-[10px] text-muted-foreground/60 italic mt-0.5">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={[
          "w-9 h-5 rounded-full relative transition-colors shrink-0",
          value ? "bg-primary" : "bg-white/10",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 size-3 rounded-full bg-white transition-all",
            value ? "left-5" : "left-1",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest block">
        {label}
      </label>
      <button className="w-full p-2.5 bg-black/20 rounded-md border border-border flex items-center justify-between hover:bg-black/30">
        <span className="text-[11px] font-mono text-foreground/80">{value}</span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{k}</span>
      <span className="text-[11px] font-mono px-2 py-0.5 bg-white/5 border border-border rounded">
        {v}
      </span>
    </div>
  );
}

function RunningPanel() {
  return (
    <div className="p-5 bg-card rounded-xl border border-border shadow-lg animate-fade-in shrink-0">
      <div className="flex items-end justify-between mb-3 gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 text-[9px] font-bold uppercase tracking-widest rounded">
              Removing Background
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              14 / 24 images
            </span>
          </div>
          <h3 className="text-base font-extrabold tracking-tight text-foreground truncate">
            Batch processing in progress…
          </h3>
        </div>
        <div className="text-right shrink-0">
          <span className="text-3xl font-mono font-medium tracking-tighter text-foreground leading-none">
            58%
          </span>
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">
            ~2m 40s left
          </p>
        </div>
      </div>

      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-border/50">
        <div className="h-full w-[58%] bg-primary shadow-[0_0_20px_hsl(235_85%_65%/0.4)] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-20 animate-shimmer" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <Stat label="Processed" value="14" />
        <Stat label="Skipped" value="8" />
        <Stat label="Errors" value="2" tone="error" />
      </div>
    </div>
  );
}

function SetupPanel() {
  return (
    <div className="p-12 bg-card rounded-2xl border border-border shadow-sm flex flex-col items-center text-center">
      <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 grid place-items-center mb-4">
        <Play className="size-5 text-primary fill-current" />
      </div>
      <h3 className="text-xl font-extrabold tracking-tight text-foreground mb-1">
        Ready to process
      </h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-6">
        Review the pipeline on the left, then start the batch. You can stop at any time.
      </p>
      <div className="flex items-center gap-6 text-[11px] font-mono text-muted-foreground">
        <span>24 images</span>
        <span className="size-1 rounded-full bg-border" />
        <span>1 excluded</span>
        <span className="size-1 rounded-full bg-border" />
        <span>1440px canvas</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "error";
}) {
  return (
    <div className="px-3 py-2 bg-white/5 rounded-lg border border-border flex items-baseline justify-between gap-2">
      <p
        className={[
          "text-[9px] uppercase font-bold tracking-widest",
          tone === "error" ? "text-error/70" : "text-muted-foreground/70",
        ].join(" ")}
      >
        {label}
      </p>
      <p
        className={[
          "text-lg font-mono leading-none",
          tone === "error" ? "text-error" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

function RecentStream() {
  const items = [
    { name: "IMG_9402.PNG", state: "ok", hue: 200 },
    { name: "IMG_9403.PNG", state: "ok", hue: 30 },
    { name: "IMG_9404.PNG", state: "err" },
    { name: "IMG_9405.PNG", state: "pending" },
  ] as const;
  return (
    <div className="space-y-2 shrink-0">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Live stream
      </h4>
      <div className="grid grid-cols-4 gap-2">
        {items.map((it) => (
          <div
            key={it.name}
            className={[
              "group relative aspect-square rounded-lg overflow-hidden border",
              it.state === "err"
                ? "border-error/30 ring-1 ring-error/10 bg-error/5"
                : "border-border bg-surface",
            ].join(" ")}
          >
            {it.state === "ok" ? (
              <div
                className="w-full h-full grid place-items-center"
                style={{
                  background: `linear-gradient(135deg, hsl(${it.hue} 35% 22%), hsl(${(it.hue + 60) % 360} 35% 12%))`,
                }}
              />
            ) : it.state === "err" ? (
              <div className="w-full h-full grid place-items-center">
                <span className="text-[9px] uppercase tracking-widest text-error">
                  Failed
                </span>
              </div>
            ) : (
              <div className="w-full h-full grid place-items-center">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground animate-pulse">
                  Pending
                </span>
              </div>
            )}
            <span
              className={[
                "absolute top-1.5 right-1.5 size-2 rounded-full",
                it.state === "ok"
                  ? "bg-success"
                  : it.state === "err"
                    ? "bg-error"
                    : "bg-muted",
              ].join(" ")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function LogsPanel({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface/50 hover:bg-white/5 shrink-0"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Pipeline telemetry · 7 entries
        </span>
        <ChevronDown
          className={[
            "size-3.5 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open && (
        <div className="font-mono text-[10px] px-3 py-2 bg-black/40 overflow-y-auto flex-1 min-h-0 space-y-1 text-foreground/70 animate-fade-in">
          <p><span className="text-primary">[14:22:01]</span> Initializing NCNN backend…</p>
          <p><span className="text-primary">[14:22:03]</span> Loading bria-rmbg weights (422MB)</p>
          <p><span className="text-primary">[14:22:08]</span> IMG_9402.PNG · upscale 2x [SUCCESS]</p>
          <p><span className="text-primary">[14:22:09]</span> IMG_9402.PNG · BG removal [SUCCESS]</p>
          <p><span className="text-primary">[14:22:12]</span> IMG_9403.PNG · upscale 2x [SUCCESS]</p>
          <p><span className="text-primary">[14:22:14]</span> IMG_9403.PNG · BG removal [SUCCESS]</p>
          <p><span className="text-error">[14:22:15]</span> IMG_9404.PNG · file corrupt or size exceeded</p>
        </div>
      )}
    </div>
  );
}
