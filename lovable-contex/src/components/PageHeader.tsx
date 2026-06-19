import type { ReactNode } from "react";

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="h-11 border-b border-border flex items-center justify-between px-6 bg-surface/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-6">
        <h1 className="text-sm font-semibold tracking-wide uppercase text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </header>
  );
}
