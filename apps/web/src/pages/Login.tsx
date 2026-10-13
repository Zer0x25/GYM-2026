/**
 * Login screen: email + password against Better Auth. On success the guard
 * redirects to the role's home. Errors come back as stable API codes.
 *
 * Design (ADR-0003): Tailwind utilities + the CSS-variable tokens from
 * index.css (bg-card, text-foreground, border-input…). The old semantic
 * classes (.card/.error) predate the design system and style nothing.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Shield, ScanLine, UserCog, User } from "lucide-react";
import { ApiError } from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";

/**
 * Dev-only quick-login: one button per role, wired to the seed accounts.
 * Never rendered in a production build (import.meta.env.DEV is false there),
 * so no credentials ship to prod even though they are plain here.
 */
const DEV_PASSWORD = "SuperSecret123!";
const DEV_ROLES: {
  key: string;
  label: string;
  email: string;
  icon: typeof Shield;
}[] = [
  { key: "admin", label: "Admin", email: "admin@pilot.cl", icon: Shield },
  { key: "recepcion", label: "Recepción", email: "recepcion@pilot.cl", icon: ScanLine },
  { key: "instructor", label: "Instructor", email: "instructor@pilot.cl", icon: UserCog },
  { key: "socio", label: "Cliente", email: "socio@pilot.cl", icon: User },
];

export function Login() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "Credenciales inválidas."
            : e.message
          : "No se pudo contactar al servidor.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  // Dev quick-login: sign in as a seed account with one tap.
  async function quickLogin(devEmail: string) {
    setError(null);
    setBusy(true);
    try {
      await signIn(devEmail, DEV_PASSWORD);
      navigate("/", { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "Credenciales inválidas."
            : e.message
          : "No se pudo contactar al servidor.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="h-6 w-6" aria-hidden />
          </span>
          <h1 id="login-title" className="text-xl font-semibold tracking-tight">
            Ingresar
          </h1>
          <p className="text-sm text-muted-foreground">Panel del gimnasio</p>
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Contraseña
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !email || !password}
          >
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>

        {import.meta.env.DEV ? (
          <div className="mt-6 border-t pt-5">
            <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Acceso rápido (dev)
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEV_ROLES.map(({ key, label, email, icon: Icon }) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => quickLogin(email)}
                  className="justify-start gap-2"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
