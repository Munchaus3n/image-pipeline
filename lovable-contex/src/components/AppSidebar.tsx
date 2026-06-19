import { Link, useRouterState } from "@tanstack/react-router";
import { Cpu } from "lucide-react";

const steps = [
  { num: "01", label: "Input", to: "/", hint: "24 images loaded", status: "Ready" as const },
  { num: "02", label: "Process", to: "/process", hint: "Configure pipeline", status: "Idle" as const },
  { num: "03", label: "Editor", to: "/editor", hint: "Place & save outputs", status: null },
] as const;

const utilities = [
  { label: "Templates", to: "/templates" },
  { label: "Settings", to: "/settings" },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="w-64 h-full border-r border-border bg-surface flex flex-col shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="size-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
          <div className="size-3 bg-primary rounded-full animate-pulse" />
        </div>
        <span className="font-extrabold tracking-tighter text-lg uppercase text-foreground">
          Pipeline Pro
        </span>
      </div>

      <div className="flex-1 px-3 space-y-1 py-4 overflow-y-auto">
        {steps.map((s) => {
          const active = pathname === s.to;
          return (
            <Link
              key={s.to}
              to={s.to}
              className={[
                "block px-3 py-4 rounded-xl transition-all duration-200",
                active
                  ? "bg-primary/10 border border-primary/20 ring-1 ring-primary/20"
                  : "border border-transparent hover:bg-white/5",
              ].join(" ")}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={[
                    "text-xs font-semibold uppercase tracking-widest",
                    active ? "text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {s.num} {s.label}
                </span>
                {s.status && (
                  <span
                    className={[
                      "text-[10px] font-mono px-1.5 py-0.5 rounded",
                      active
                        ? "bg-primary/20 text-primary"
                        : "bg-white/5 text-success",
                    ].join(" ")}
                  >
                    {active ? "Active" : s.status}
                  </span>
                )}
              </div>
              <p
                className={[
                  "text-xs font-medium",
                  active ? "text-primary/70" : "text-muted-foreground/70",
                ].join(" ")}
              >
                {s.hint}
              </p>
            </Link>
          );
        })}

        <div className="h-px bg-border my-4 mx-3" />

        {utilities.map((u) => {
          const active = pathname === u.to;
          return (
            <Link
              key={u.to}
              to={u.to}
              className={[
                "block px-3 py-3 rounded-xl transition-all",
                active
                  ? "bg-white/5 text-foreground"
                  : "hover:bg-white/5 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <span className="text-xs font-medium">{u.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="p-6">
        <div className="p-3 bg-white/5 rounded-xl border border-border">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-tighter text-muted-foreground mb-2">
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3" /> System
            </span>
            <span className="text-success">GPU: On</span>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-primary rounded-full" />
          </div>
        </div>
      </div>
    </nav>
  );
}
