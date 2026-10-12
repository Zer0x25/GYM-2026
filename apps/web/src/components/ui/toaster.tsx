import { Toaster as SonnerToaster } from "sonner";

/**
 * App-wide toaster (sonner). Mounted once in the shell; calls anywhere via
 * toast.success/error (ADR-0003 reception UX feedback).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "rounded-md border bg-card text-card-foreground shadow-lg",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}

export { toast } from "sonner";
