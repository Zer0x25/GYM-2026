import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";

export function VerifyContact() {
  const { session } = useSession();
  const location = useLocation(),
    navigate = useNavigate();
  const [token] = useState(() => location.hash.slice(1));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const member = await api.me();
      await api.confirmContactVerification(member.id, token);
      setMessage("Contacto verificado y actualizado. Tu correo de ingreso se mantiene.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar el contacto.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold">Verificar contacto</h1>
        {!session ? (
          <p className="mt-4 text-sm">
            Ingresa con tu cuenta y vuelve a abrir el enlace de verificación.
          </p>
        ) : session.role !== "socio" ? (
          <p className="mt-4 text-sm">
            Este enlace requiere la cuenta del socio que solicitó el cambio.
          </p>
        ) : message ? (
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
        ) : !token ? (
          <p role="alert" className="mt-4 text-sm">
            Falta el enlace de verificación. Solicita uno nuevo desde tu portal.
          </p>
        ) : (
          <>
            <p className="my-4 text-sm">
              Confirma para guardar el nuevo correo de contacto solicitado desde tu portal.
            </p>
            <Button disabled={busy} onClick={() => void confirm()}>
              {busy ? "Verificando…" : "Confirmar contacto"}
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <Link
          to={session ? "/" : "/login"}
          className="mt-6 block text-sm text-primary hover:underline"
        >
          {session ? "Volver al portal" : "Ingresar"}
        </Link>
      </section>
    </main>
  );
}
