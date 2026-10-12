import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { cn } from "./lib/cn.js";
import { api, formatCLP, type CashSession } from "./api.js";
import { SessionProvider, useSession } from "./session.js";
import { RequireAuth, RequireStaff } from "./guards.jsx";
import { Login } from "./pages/Login.js";
import { Panel } from "./pages/Panel.js";
import { Portal } from "./pages/Portal.js";
import { Payments } from "./pages/Payments.js";
import { Cash } from "./pages/Cash.js";
import { Toaster } from "./components/ui/toaster.js";
import { Users, Wallet, Receipt, LogOut, Dumbbell } from "lucide-react";

/**
 * App shell with session-aware routing and the reception layout (ADR-0003):
 * collapsible sidebar by domain + topbar with the open-cash badge.
 * Client-side guards are UX; the API re-validates every request.
 */
export function App() {
  return (
    <SessionProvider>
      <Shell />
      <Toaster />
    </SessionProvider>
  );
}

function Shell() {
  const { session, signOut } = useSession();
  const isStaff = session && session.role !== "socio";
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (!isStaff) {
    // socio: self-service only, no shell chrome.
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="container flex h-16 items-center justify-between">
            <span className="flex items-center gap-2 font-semibold">
              <Dumbbell className="h-5 w-5 text-primary" />
              {session.organization.name}
            </span>
            <button type="button" className="text-sm text-muted-foreground hover:underline" onClick={() => void signOut()}>
              Salir
            </button>
          </div>
        </header>
        <main className="container py-6">
          <Routes>
            <Route path="/portal" element={<RequireAuth roles={["socio"]}><Portal /></RequireAuth>} />
            <Route path="*" element={<Portal />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar by domain */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-card transition-all",
          sidebarOpen ? "w-60" : "w-16",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <Dumbbell className="h-6 w-6 shrink-0 text-primary" />
          {sidebarOpen && <span className="truncate font-semibold">{session.organization.name}</span>}
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Principal">
          <SideLink to="/panel" icon={<Users className="h-4 w-4" />} open={sidebarOpen}>
            Socios
          </SideLink>
          <SideLink to="/payments" icon={<Receipt className="h-4 w-4" />} open={sidebarOpen}>
            Pagos
          </SideLink>
          <SideLink to="/cash" icon={<Wallet className="h-4 w-4" />} open={sidebarOpen}>
            Caja
          </SideLink>
        </nav>
        <div className="border-t p-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            {sidebarOpen ? "« Colapsar" : "»"}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            {sidebarOpen && "Salir"}
          </button>
        </div>
      </aside>

      {/* Topbar with open-cash badge */}
      <div className={cn("transition-all", sidebarOpen ? "pl-60" : "pl-16")}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-6 backdrop-blur">
          <span className="text-sm text-muted-foreground">
            {session.user.email} · <strong>{session.role}</strong>
          </span>
          <CashBadge />
        </header>
        <main className="container py-6">
          <Routes>
            <Route path="/panel" element={<RequireStaff><Panel /></RequireStaff>} />
            <Route path="/payments" element={<RequireStaff><Payments /></RequireStaff>} />
            <Route path="/cash" element={<RequireStaff><Cash /></RequireStaff>} />
            <Route path="*" element={<RequireStaff><Panel /></RequireStaff>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function SideLink({
  to,
  icon,
  open,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      {icon}
      {open && children}
    </NavLink>
  );
}

/** Topbar badge: shows the open cash session and its running total. */
function CashBadge() {
  const [session, setSession] = useState<CashSession | null>(null);
  useEffect(() => {
    void api.currentCashSession().then(setSession).catch(() => setSession(null));
  }, []);
  if (!session) {
    return <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Caja cerrada</span>;
  }
  return (
    <span className="flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
      <span className="h-2 w-2 rounded-full bg-success" />
      Caja abierta · apertura {formatCLP(session.openingCents)}
    </span>
  );
}
