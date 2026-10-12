import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Payment state badge — the reception UX colour language (ADR-0003):
 * provisional (pending human decision) = warning; validated = success;
 * rejected = destructive.
 */
export function PaymentStateBadge({ state }: { state: string }) {
  const map: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    provisional: { variant: "warning", label: "Provisional" },
    validated: { variant: "success", label: "Validado" },
    rejected: { variant: "destructive", label: "Rechazado" },
  };
  const s = map[state] ?? { variant: "secondary" as const, label: state };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Membership state badge — derived from validated payments:
 * active = success; pending_payment = warning; expired = destructive.
 */
export function MembershipStateBadge({ state }: { state: string }) {
  const map: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    active: { variant: "success", label: "Activa" },
    pending_payment: { variant: "warning", label: "Pend. de pago" },
    expired: { variant: "destructive", label: "Vencida" },
  };
  const s = map[state] ?? { variant: "secondary" as const, label: state };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Session state badge — programada = success; cancelada = destructive;
 * completada = secondary.
 */
export function SessionStateBadge({ state }: { state: string }) {
  const map: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    programada: { variant: "success", label: "Programada" },
    cancelada: { variant: "destructive", label: "Cancelada" },
    completada: { variant: "secondary", label: "Completada" },
  };
  const s = map[state] ?? { variant: "secondary" as const, label: state };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Booking state badge — confirmada = success; cancelada = destructive;
 * ausente = warning.
 */
export function BookingStateBadge({ state }: { state: string }) {
  const map: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    confirmada: { variant: "success", label: "Confirmada" },
    cancelada: { variant: "destructive", label: "Cancelada" },
    ausente: { variant: "warning", label: "Ausente" },
  };
  const s = map[state] ?? { variant: "secondary" as const, label: state };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export { Badge, badgeVariants };
