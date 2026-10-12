/**
 * Member portal (socio): own profile and contact edit. The socio role only
 * ever reads /members/me (server-validated); the id in the URL is cosmetic —
 * the API resolves the socio from the session.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type Member } from "../api.js";

export function Portal() {
  const [me, setMe] = useState<Member | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setContactEmail(m.contactEmail ?? "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar el perfil");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateContact(me!.id, contactEmail.trim() || null);
      setMe(updated);
      setNotice("Contacto actualizado.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="portal-title">
      <h1 id="portal-title">Mi perfil</h1>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {me ? (
        <>
          <p>
            <strong>{me.fullName}</strong>
          </p>
          <form onSubmit={onSave}>
            <label htmlFor="contactEmail">Email de contacto</label>
            <input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </form>
          <p className="muted">
            Solo podés ver y editar tu propia información.
          </p>
        </>
      ) : (
        <p className="muted">Cargando perfil…</p>
      )}
    </section>
  );
}
