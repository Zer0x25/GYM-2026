/**
 * Route guard: requires an authenticated session (any role) and optionally
 * a specific role. While the session loads it renders nothing (the shell
 * shows a skeleton); unauthenticated or unauthorized users are redirected.
 *
 * Authorization on the client is UX only — the API re-validates every call
 * (docs/api/README.md, matriz de permisos).
 */
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSession } from "./session.js";
import type { SessionData } from "./api.js";

const STAFF: SessionData["role"][] = ["admin", "recepcion", "instructor"];

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: SessionData["role"][];
}) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <p className="grid min-h-screen place-items-center text-sm text-muted-foreground">Verificando sesión…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(session.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Guard for staff-only areas (panel): admin/recepción/instructor. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <p className="grid min-h-screen place-items-center text-sm text-muted-foreground">Verificando sesión…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!STAFF.includes(session.role)) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

/**
 * Guard for staff areas further restricted to specific roles (mirror of the
 * backend matrix — see permissions.ts). UX only: the API re-validates.
 * Unauthorized staff bounce to their landing ("/"), never to /login.
 */
export function RequireRoles({
  roles,
  children,
}: {
  roles: SessionData["role"][];
  children: ReactNode;
}) {
  const { session, loading } = useSession();
  if (loading) return <p className="grid min-h-screen place-items-center text-sm text-muted-foreground">Verificando sesión…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (!roles.includes(session.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
