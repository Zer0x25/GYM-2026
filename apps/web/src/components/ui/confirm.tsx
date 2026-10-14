import * as Alert from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";
import { Button } from "./button.js";

export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  children,
  onConfirm,
  busy = false,
  label = "Confirmar",
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  onConfirm: () => void;
  busy?: boolean;
  label?: string;
  destructive?: boolean;
}) {
  return (
    <Alert.Root open={open} onOpenChange={onOpenChange}>
      <Alert.Portal>
        <Alert.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Alert.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-xl">
          <Alert.Title className="text-lg font-semibold">{title}</Alert.Title>
          <Alert.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {description}
          </Alert.Description>
          {children && <div className="mt-5">{children}</div>}
          <div className="mt-6 flex justify-end gap-2">
            <Alert.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancelar
              </Button>
            </Alert.Cancel>
            <Alert.Action asChild>
              <Button
                disabled={busy}
                variant={destructive ? "destructive" : "default"}
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                {busy ? "Procesando…" : label}
              </Button>
            </Alert.Action>
          </div>
        </Alert.Content>
      </Alert.Portal>
    </Alert.Root>
  );
}
