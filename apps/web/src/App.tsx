import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Users,
  Wallet,
  Receipt,
  LogOut,
  Dumbbell,
  CalendarDays,
  ScanLine,
  LayoutDashboard,
  Layers,
  UserRoundCog,
  Menu,
  X,
  Wifi,
  WifiOff,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { api, type CashSession } from "./api.js";
import { SessionProvider, useSession } from "./session.js";
import { RequireStaff, RequireRoles } from "./guards.js";
import { Login } from "./pages/Login.js";
import { Mostrador } from "./pages/Mostrador.js";
import { Panel } from "./pages/Panel.js";
import { MemberDetail } from "./pages/MemberDetail.js";
import { Plans } from "./pages/Plans.js";
import { Portal } from "./pages/Portal.js";
import { Payments } from "./pages/Payments.js";
import { Cash } from "./pages/Cash.js";
import { Classes } from "./pages/Classes.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Reports } from "./pages/Reports.js";
import { Team } from "./pages/Team.js";
import { Offline } from "./pages/Offline.js";
import { Toaster } from "./components/ui/toaster.js";
import { Confirm } from "./components/ui/confirm.js";
import { Button } from "./components/ui/button.js";
import { cn } from "./lib/cn.js";
export function App() {
  return (
    <SessionProvider>
      <Shell />
      <Toaster />
    </SessionProvider>
  );
}
function Shell() {
  const { session, loading, signOut } = useSession();
  const [mobile, setMobile] = useState(false),
    [otherSessions, setOtherSessions] = useState(false),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  useEffect(() => {
    setMobile(false);
  }, [location.pathname]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  async function exit() {
    try {
      await signOut();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo salir");
    }
  }
  if (location.pathname === "/contingencia")
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card px-6 py-4">
          <Link to="/login" className="text-sm font-semibold text-primary">
            GYM · Volver al acceso
          </Link>
        </header>
        <main className="mx-auto max-w-5xl p-4 sm:p-8">
          <Offline />
        </main>
      </div>
    );
  if (loading)
    return (
      <p
        role="status"
        className="grid min-h-screen place-items-center text-sm text-muted-foreground"
      >
        Verificando sesión…
      </p>
    );
  if (!session) return <Login />;
  const reception = session.role === "admin" || session.role === "recepcion";
  const admin = session.role === "admin";
  if (session.role === "socio")
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Dumbbell className="h-5 w-5 text-primary" />
              {session.organization.name}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void exit()}>
              Salir
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <Portal />
        </main>
      </div>
    );
  const nav = [
    ...(admin ? [{ to: "/", label: "Resumen", icon: LayoutDashboard }] : []),
    ...(reception ? [{ to: admin ? "/mostrador" : "/", label: "Mostrador", icon: ScanLine }] : []),
    { to: "/panel", label: "Socios", icon: Users },
    ...(reception
      ? [
          { to: "/planes", label: "Planes", icon: Layers },
          { to: "/payments", label: "Pagos", icon: Receipt },
          { to: "/cash", label: "Caja", icon: Wallet },
          { to: "/reportes", label: "Reportes", icon: BarChart3 },
        ]
      : []),
    {
      to: "/clases",
      label: session.role === "instructor" ? "Mi agenda" : "Clases y agenda",
      icon: CalendarDays,
    },
    ...(admin ? [{ to: "/equipo", label: "Equipo", icon: UserRoundCog }] : []),
    ...(reception ? [{ to: "/contingencia", label: "Contingencia", icon: WifiOff }] : []),
  ];
  return (
    <div className="min-h-screen bg-background">
      {mobile && (
        <button
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-slate-950 text-slate-300 transition-transform lg:translate-x-0",
          mobile ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <span className="rounded-lg bg-primary p-2.5 text-white">
            <Dumbbell className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight text-white">
              GYM<span className="text-slate-400"> /</span>
            </p>
            <p className="truncate text-[11px] text-slate-400">{session.organization.name}</p>
          </div>
          <button
            aria-label="Cerrar menú"
            className="ml-auto lg:hidden"
            onClick={() => setMobile(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Tu espacio de trabajo
        </div>
        <nav aria-label="Principal" className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-white/10 font-medium text-white"
                    : "hover:bg-white/5 hover:text-white",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <button
            className="flex w-full items-center gap-3 rounded-lg p-2 text-xs hover:bg-white/5"
            onClick={() => setOtherSessions(true)}
          >
            <ShieldCheck className="h-4 w-4" />
            Cerrar mis otras sesiones
          </button>
          <button
            className="mt-2 flex w-full items-center gap-3 rounded-lg p-2 text-sm hover:bg-white/5"
            onClick={() => void exit()}
          >
            <LogOut className="h-4 w-4" />
            Salir
          </button>
          <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold">
              {session.user.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-white">{session.user.email}</p>
              <p className="mt-1 text-[10px] capitalize text-slate-500">
                {session.role === "recepcion"
                  ? "Recepción"
                  : session.role === "instructor"
                    ? "Instructor"
                    : "Administración"}
              </p>
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <button
              aria-label="Abrir menú"
              className="rounded-md p-2 lg:hidden"
              onClick={() => setMobile(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className="hidden text-xs capitalize text-muted-foreground sm:block">
              {new Date().toLocaleDateString("es-CL", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                online ? "text-muted-foreground" : "text-warning",
              )}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? "Red disponible" : "Sin conexión"}
            </span>
            {reception && <CashBadge />}
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-8 sm:py-9">
          <Routes>
            <Route
              path="/"
              element={
                admin ? (
                  <Dashboard />
                ) : reception ? (
                  <Mostrador />
                ) : (
                  <Navigate to="/clases" replace />
                )
              }
            />
            <Route
              path="/mostrador"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Mostrador />
                </RequireRoles>
              }
            />
            <Route
              path="/panel"
              element={
                <RequireStaff>
                  <Panel />
                </RequireStaff>
              }
            />
            <Route
              path="/panel/:id"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <MemberDetail />
                </RequireRoles>
              }
            />
            <Route
              path="/planes"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Plans />
                </RequireRoles>
              }
            />
            <Route
              path="/payments"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Payments />
                </RequireRoles>
              }
            />
            <Route
              path="/cash"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Cash />
                </RequireRoles>
              }
            />
            <Route
              path="/clases"
              element={
                <RequireStaff>
                  <Classes />
                </RequireStaff>
              }
            />
            <Route
              path="/clases/:id"
              element={
                <RequireStaff>
                  <SessionDetail />
                </RequireStaff>
              }
            />
            <Route
              path="/reportes"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Reports />
                </RequireRoles>
              }
            />
            <Route
              path="/equipo"
              element={
                <RequireRoles roles={["admin"]}>
                  <Team />
                </RequireRoles>
              }
            />
            <Route
              path="/contingencia"
              element={
                <RequireRoles roles={["admin", "recepcion"]}>
                  <Offline />
                </RequireRoles>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <Confirm
        open={otherSessions}
        onOpenChange={setOtherSessions}
        title="Cerrar mis otras sesiones"
        description="Tu sesión actual seguirá abierta. Los demás equipos deberán volver a iniciar sesión."
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void api
            .revokeOthers()
            .then(() => {
              setOtherSessions(false);
              toast.success("Otras sesiones cerradas");
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
function CashBadge() {
  const [cash, setCash] = useState<CashSession | null>(null),
    [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    try {
      setCash(await api.currentCashSession());
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    const id = setInterval(refresh, 30000);
    window.addEventListener("gym:data-changed", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("gym:data-changed", refresh);
    };
  }, [load]);
  return (
    <Link
      to="/cash"
      className={cn(
        "rounded-full border px-3 py-1.5 text-[11px] font-medium",
        state === "ready" && cash
          ? "border-success/20 bg-success/5 text-success"
          : "text-muted-foreground",
      )}
    >
      {state === "loading"
        ? "Consultando caja…"
        : state === "error"
          ? "Caja no disponible"
          : cash
            ? "Caja abierta"
            : "Caja cerrada"}
    </Link>
  );
}
