import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./button.js";
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  );
}
export function ErrorNotice({ message, retry }: { message: string | null; retry?: () => void }) {
  return message ? (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw className="h-3 w-3" />
          Reintentar
        </Button>
      )}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
      Cargando información…
    </div>
  );
}
export function Stat({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
export function Select({
  label,
  id,
  children,
  ...props
}: {
  label: string;
  id: string;
  children: ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        {...props}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
      >
        {children}
      </select>
    </div>
  );
}
