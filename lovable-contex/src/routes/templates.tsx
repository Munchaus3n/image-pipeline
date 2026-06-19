import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Plus, Trash2, ImageIcon } from "lucide-react";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
  head: () => ({ meta: [{ title: "Templates — Pipeline Pro" }] }),
});

type Template = {
  id: string;
  name: string;
  zone: "none" | "green" | "blue" | "magenta" | "red";
  hint: string;
};

const seed: Template[] = [
  { id: "1", name: "saldainis", zone: "blue", hint: "" },
  { id: "2", name: "test", zone: "blue", hint: "Left + right touch blue lines" },
];

const ZONE_COLOR: Record<Template["zone"], string> = {
  none: "hsl(240 5% 50%)",
  green: "hsl(142 70% 45%)",
  blue: "hsl(235 85% 65%)",
  magenta: "hsl(310 85% 65%)",
  red: "hsl(0 85% 60%)",
};

function TemplatesPage() {
  const [list] = useState<Template[]>(seed);
  const [activeId, setActiveId] = useState("1");
  const active = list.find((t) => t.id === activeId)!;
  const [zone, setZone] = useState<Template["zone"]>(active.zone);

  return (
    <>
      <PageHeader title="Templates · Presets">
        <button className="px-5 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-lg ring-2 ring-primary/20 shadow-lg shadow-primary/20 inline-flex items-center gap-2 hover:brightness-110">
          <Plus className="size-3.5" /> New template
        </button>
      </PageHeader>

      <div className="flex-1 flex overflow-hidden">
        {/* List */}
        <aside className="w-80 border-r border-border bg-surface/30 p-4 overflow-y-auto space-y-2 shrink-0">
          {list.map((t) => {
            const isActive = t.id === activeId;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveId(t.id);
                  setZone(t.zone);
                }}
                className={[
                  "w-full text-left p-3 rounded-xl border transition flex items-center gap-3",
                  isActive
                    ? "bg-primary/10 border-primary/20 ring-1 ring-primary/20"
                    : "border-border hover:bg-white/5",
                ].join(" ")}
              >
                <div
                  className="size-10 rounded-lg border border-border grid place-items-center shrink-0"
                  style={{ background: `${ZONE_COLOR[t.zone]}15` }}
                >
                  <ImageIcon
                    className="size-4"
                    style={{ color: ZONE_COLOR[t.zone] }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {t.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {t.hint || `Zone · ${t.zone}`}
                  </p>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Editor */}
        <section className="flex-1 overflow-y-auto p-8 max-w-3xl">
          <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Edit — {active.name}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Templates apply placement & guide settings to images in the editor.
              </p>
            </div>

            <Field label="Name">
              <input
                defaultValue={active.name}
                className="w-full bg-black/30 border border-border rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-primary/40"
              />
            </Field>

            <Field label="Zone">
              <div className="flex gap-2 flex-wrap">
                {(["none", "green", "blue", "magenta", "red"] as const).map(
                  (z) => {
                    const active = z === zone;
                    return (
                      <button
                        key={z}
                        onClick={() => setZone(z)}
                        className={[
                          "px-3 py-1.5 text-xs font-medium rounded-md border transition",
                          active ? "ring-2 ring-offset-2 ring-offset-card" : "",
                        ].join(" ")}
                        style={{
                          background: `${ZONE_COLOR[z]}15`,
                          borderColor: `${ZONE_COLOR[z]}55`,
                          color: ZONE_COLOR[z],
                          // @ts-expect-error css var
                          "--tw-ring-color": ZONE_COLOR[z],
                        }}
                      >
                        {z}
                      </button>
                    );
                  },
                )}
              </div>
            </Field>

            <Field label="Hint" hint="Shown in the editor as guidance.">
              <input
                defaultValue={active.hint}
                placeholder="e.g. Top + bottom touch green lines"
                className="w-full bg-black/30 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary/40"
              />
            </Field>

            <Field label="Reference image">
              <div className="rounded-xl border border-dashed border-border bg-black/20 aspect-video grid place-items-center">
                <div className="text-center">
                  <ImageIcon className="size-6 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Drop image or browse
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-white/5">
                  Replace
                </button>
                <button className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-white/5">
                  Browse…
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <button className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-success/15 text-success rounded-lg border border-success/30 hover:bg-success/20">
                Save template
              </button>
              <button className="px-3 py-2 text-xs font-medium text-error inline-flex items-center gap-1.5 hover:bg-error/10 rounded-md">
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        {hint && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}
