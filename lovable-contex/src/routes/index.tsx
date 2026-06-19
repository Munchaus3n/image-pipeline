import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Search, FolderOpen, Eye, X, Ban, ImageOff, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: InputPage,
  head: () => ({ meta: [{ title: "Input — Pipeline Pro" }] }),
});

type Img = {
  id: string;
  name: string;
  excluded?: boolean;
  broken?: boolean;
  hue: number;
};

const initial: Img[] = Array.from({ length: 18 }).map((_, i) => ({
  id: String(i),
  name: `coffee_fest_${String(i + 1).padStart(2, "0")}.png`,
  excluded: i === 4 || i === 11,
  broken: i === 9,
  hue: (i * 37) % 360,
}));

function InputPage() {
  const [folder] = useState("C:/Users/liulis/Downloads/New folder (3)");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(["2"]));
  const [items, setItems] = useState<Img[]>(initial);
  const [previewId, setPreviewId] = useState<string | null>("2");

  const filtered = items.filter((i) =>
    i.name.toLowerCase().includes(query.toLowerCase()),
  );
  const preview = items.find((i) => i.id === previewId) ?? null;
  const excludedCount = items.filter((i) => i.excluded).length;

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setPreviewId(id);
  };

  const allSelected = filtered.every((f) => selected.has(f.id));
  const selectAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((f) => f.id)));

  const excludeSelected = () => {
    setItems((arr) =>
      arr.map((i) => (selected.has(i.id) ? { ...i, excluded: true } : i)),
    );
  };
  const removeSelected = () => {
    setItems((arr) => arr.filter((i) => !selected.has(i.id)));
    setSelected(new Set());
  };

  return (
    <>
      <PageHeader title="Input · Review">
        <span className="text-[11px] font-mono text-muted-foreground">
          {items.length} images{excludedCount ? ` · ${excludedCount} excluded` : ""}
        </span>
        <button className="px-5 py-2 text-xs font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-lg ring-2 ring-primary/20 shadow-lg shadow-primary/20 inline-flex items-center gap-2 hover:brightness-110 transition">
          Go to Process <ArrowRight className="size-3.5" />
        </button>
      </PageHeader>

      <div className="flex-1 flex overflow-hidden">
        {/* Grid */}
        <section className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="px-8 pt-6 pb-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="flex-1 text-xs font-mono truncate text-foreground/80">
                  {folder}
                </span>
                <button className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-border text-muted-foreground hover:bg-white/5">
                  Browse
                </button>
              </div>
              <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 w-72">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by filename…"
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            {selected.size > 0 ? (
              <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 animate-fade-in">
                <span className="text-xs font-medium text-primary">
                  {selected.size} selected
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={excludeSelected}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-md hover:bg-warning/10 text-warning inline-flex items-center gap-1.5"
                  >
                    <Ban className="size-3" /> Exclude from BG
                  </button>
                  <button
                    onClick={removeSelected}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-md hover:bg-error/10 text-error inline-flex items-center gap-1.5"
                  >
                    <X className="size-3" /> Remove from session
                  </button>
                  <div className="h-4 w-px bg-border mx-1" />
                  <button
                    onClick={() => setSelected(new Set())}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-md text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <span>Click an image to select. Use the inspector for actions.</span>
                <button
                  onClick={selectAll}
                  className="font-medium text-foreground/70 hover:text-foreground"
                >
                  {allSelected ? "Select none" : "Select all"}
                </button>
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-8 pb-8">
            {filtered.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filtered.map((img) => {
                  const isSel = selected.has(img.id);
                  return (
                    <button
                      key={img.id}
                      onClick={() => toggle(img.id)}
                      className={[
                        "group relative text-left bg-surface border rounded-xl overflow-hidden transition-all",
                        isSel
                          ? "border-primary/60 ring-2 ring-primary/30"
                          : "border-border hover:border-white/20",
                        img.excluded ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      <div
                        className="aspect-square w-full grid place-items-center"
                        style={{
                          background: img.broken
                            ? "transparent"
                            : `linear-gradient(135deg, hsl(${img.hue} 30% 18%), hsl(${(img.hue + 60) % 360} 30% 10%))`,
                        }}
                      >
                        {img.broken ? (
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            <ImageOff className="size-6" />
                            <span className="text-[9px] uppercase tracking-widest">
                              No preview
                            </span>
                          </div>
                        ) : (
                          <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">
                            {img.name.slice(0, 14)}
                          </span>
                        )}
                      </div>

                      {/* status overlay */}
                      {img.excluded && (
                        <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/30">
                          Excluded
                        </span>
                      )}
                      {isSel && (
                        <span className="absolute top-2 right-2 size-5 rounded-md bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center">
                          ✓
                        </span>
                      )}

                      <div className="px-3 py-2 flex items-center justify-between border-t border-border bg-card/60">
                        <span className="text-[11px] font-mono truncate text-foreground/80">
                          {img.name}
                        </span>
                        <Eye
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewId(img.id);
                          }}
                          className="size-3.5 text-muted-foreground hover:text-foreground shrink-0"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Inspector */}
        <aside className="w-80 border-l border-border bg-surface/30 flex flex-col shrink-0">
          <div className="p-6 border-b border-border">
            <h3 className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
              Preview
            </h3>
          </div>
          {preview ? (
            <div className="p-6 space-y-5 overflow-y-auto">
              <div
                className="aspect-square w-full rounded-xl border border-border grid place-items-center"
                style={{
                  background: preview.broken
                    ? "transparent"
                    : `linear-gradient(135deg, hsl(${preview.hue} 35% 22%), hsl(${(preview.hue + 60) % 360} 35% 12%))`,
                }}
              >
                {preview.broken ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageOff className="size-8" />
                    <span className="text-[10px] uppercase tracking-widest">
                      Preview unavailable
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      AVIF fallback
                    </span>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">
                    {preview.name}
                  </span>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-1">
                  Filename
                </p>
                <p className="text-xs font-mono text-foreground break-all">
                  {preview.name}
                </p>
              </div>

              <div className="pt-4 border-t border-border space-y-2">
                <button
                  onClick={() =>
                    setItems((arr) =>
                      arr.map((i) =>
                        i.id === preview.id ? { ...i, excluded: !i.excluded } : i,
                      ),
                    )
                  }
                  className="w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:bg-white/5 text-xs"
                >
                  <span>Exclude from BG removal</span>
                  <span
                    className={[
                      "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                      preview.excluded
                        ? "bg-warning/15 text-warning"
                        : "bg-white/5 text-muted-foreground",
                    ].join(" ")}
                  >
                    {preview.excluded ? "On" : "Off"}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setItems((arr) => arr.filter((i) => i.id !== preview.id));
                    setPreviewId(null);
                  }}
                  className="w-full px-3 py-2.5 rounded-lg border border-error/20 text-error text-xs font-medium hover:bg-error/10"
                >
                  Remove from session
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-xs text-muted-foreground">
              Select an image to preview.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="mx-auto size-12 rounded-xl bg-primary/10 border border-primary/20 grid place-items-center mb-4">
          <FolderOpen className="size-5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1">No images yet</h3>
        <p className="text-xs text-muted-foreground">
          Choose an input folder to start. Pipeline Pro will scan supported formats and
          build a preview grid.
        </p>
      </div>
    </div>
  );
}
