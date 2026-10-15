import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { LockKeyhole, RefreshCw, Download, Plus } from "lucide-react";
import {
  api,
  formatCLP,
  type Device,
  type OfflineEvent,
  type OfflineMember,
  type Staff,
} from "../api.js";
import { useSession } from "../session.js";
import { PageHead, ErrorNotice, Select } from "../components/ui/page.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { Confirm } from "../components/ui/confirm.js";
import {
  checkLease,
  decryptBundle,
  getVault,
  listVaults,
  saveVault,
  vaultId,
  withVaultLock,
  writeVault,
  type Envelope,
  type VaultBundle,
} from "../lib/offline-vault.js";
export function Offline() {
  const { session } = useSession();
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [phrase, setPhrase] = useState(""),
    [bundle, setBundle] = useState<VaultBundle | null>(null),
    [activeId, setActiveId] = useState(""),
    [deviceId, setDeviceId] = useState(""),
    [devices, setDevices] = useState<Device[]>([]),
    [allDevices, setAllDevices] = useState<Device[]>([]),
    [staff, setStaff] = useState<Staff[]>([]),
    [policy, setPolicy] = useState<{ enabled: boolean; freshnessHours: number } | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [verified, setVerified] = useState(false),
    [reachable, setReachable] = useState<boolean | null>(null),
    [query, setQuery] = useState(""),
    [memberId, setMemberId] = useState(""),
    [folio, setFolio] = useState(""),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [comment, setComment] = useState(""),
    [method, setMethod] = useState<"cash" | "transfer" | "transbank">("cash"),
    [label, setLabel] = useState(""),
    [operator, setOperator] = useState(""),
    [enable, setEnable] = useState(false),
    [lockConfirm, setLockConfirm] = useState(false),
    [revoke, setRevoke] = useState<Device | null>(null);
  const phraseRef = useRef("");
  const syncBusy = useRef(false);
  const admin = session?.role === "admin";
  const load = useCallback(async () => {
    try {
      setEnvelopes(await listVaults());
      if (session) {
        const [own, p] = await Promise.all([api.ownDevices(), api.offlinePolicy()]);
        setDevices(own);
        setPolicy(p);
        if (admin) {
          const [team, all] = await Promise.all([api.staff(), api.devices()]);
          setStaff(team);
          setAllDevices(all);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la contingencia");
    }
  }, [session, admin]);
  useEffect(() => {
    void load();
  }, [load]);
  const lock = useCallback(() => {
    setBundle(null);
    setActiveId("");
    setPhrase("");
    phraseRef.current = "";
    setVerified(false);
  }, []);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setReachable(navigator.onLine ? null : false);
      setVerified(false);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("gym:session-expired", lock);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("gym:session-expired", lock);
    };
  }, [lock]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (bundle?.events.length) {
        e.preventDefault();
        e.returnValue = "Hay eventos sin sincronizar";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bundle]);
  async function updateVault(change: (value: VaultBundle) => VaultBundle) {
    if (!activeId) throw new Error("Desbloquea el dispositivo");
    return withVaultLock(activeId, async () => {
      const saved = await getVault(activeId);
      if (!saved) throw new Error("No existe la copia local");
      const current = await decryptBundle(saved, phraseRef.current);
      const next = change(current);
      await writeVault(activeId, saved.label, next, phraseRef.current);
      setBundle(next);
      return next;
    });
  }
  async function prepare(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.locks || !crypto.subtle)
        throw new Error("Se requiere navegador compatible y contexto seguro (HTTPS o localhost)");
      if (import.meta.env.PROD && "serviceWorker" in navigator) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "No se pudo preparar la recarga offline. Mantén conexión y reintenta.",
                    ),
                  ),
                10000,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      const lease = await api.offlineLease(deviceId);
      const id = vaultId(lease);
      await withVaultLock(id, async () => {
        const old = await getVault(id);
        const previous = old ? await decryptBundle(old, phrase) : null;
        const value: VaultBundle = {
          lease,
          events: previous?.events ?? [],
          results: previous?.results ?? [],
          lastClock: Date.now(),
          organizationName: session.organization.name,
        };
        await writeVault(
          id,
          devices.find((d) => d.id === deviceId)?.label ?? "Recepción",
          value,
          phrase,
        );
        setBundle(value);
      });
      phraseRef.current = phrase;
      setPhrase("");
      setActiveId(id);
      setVerified(true);
      setReachable(true);
      setEnvelopes(await listVaults());
      toast.success("Dispositivo preparado por 72 horas");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar");
    } finally {
      setBusy(false);
    }
  }
  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await getVault(selectedId);
      if (!saved) throw new Error("Selecciona una copia local");
      const value = await decryptBundle(saved, phrase);
      if (saved.id !== vaultId(value.lease))
        throw new Error("La copia no corresponde al dispositivo indicado");
      if (
        session &&
        (session.user.id !== value.lease.accountId ||
          session.organization.id !== value.lease.organizationId)
      )
        throw new Error("Inicia sesión con el operador asignado a esta copia");
      phraseRef.current = phrase;
      setPhrase("");
      setBundle(value);
      setActiveId(selectedId);
      setVerified(false);
      setReachable(null);
      toast.success("Copia local desbloqueada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desbloquear");
    } finally {
      setBusy(false);
    }
  }
  async function revalidate() {
    if (!bundle || !session) throw new Error("Inicia sesión con el operador para revalidar");
    if (
      session.user.id !== bundle.lease.accountId ||
      session.organization.id !== bundle.lease.organizationId
    )
      throw new Error("Operador distinto de la copia local");
    const lease = await api.offlineLease(bundle.lease.deviceId);
    setReachable(true);
    await updateVault((value) => ({ ...value, lease, lastClock: Date.now() }));
    setVerified(true);
  }
  async function capture(type: "cobro_provisional" | "ingreso_contingencia") {
    if (!bundle || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (online && reachable !== false && !verified) {
        await revalidate();
        throw new Error("Permiso revalidado. Revisa el socio y confirma nuevamente.");
      }
      if (!folio.trim()) throw new Error("Anota un folio externo antes de registrar");
      const member = bundle.lease.members.find((m) => m.id === memberId);
      if (!member) throw new Error("Selecciona un socio de la instantánea");
      if (
        type === "cobro_provisional" &&
        (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0 || !member.membershipId)
      )
        throw new Error("El cobro necesita membresía y un monto entero positivo");
      if (
        type === "cobro_provisional" &&
        method === "transbank" &&
        (!reference.trim() ||
          reference.trim().length > 200 ||
          !comment.trim() ||
          comment.trim().length > 1000)
      )
        throw new Error("Transbank externo necesita número de operación y comentario válidos");
      await updateVault((value) => {
        checkLease(
          value.lease,
          {
            accountId: session?.user.id ?? value.lease.accountId,
            organizationId: session?.organization.id ?? value.lease.organizationId,
          },
          Date.now(),
          value.lastClock,
        );
        const current = value.lease.members.find((m) => m.id === memberId);
        if (!current) throw new Error("Socio ausente de la instantánea");
        if (
          type === "ingreso_contingencia" &&
          (current.coverage === "none" || !current.endAt || Date.now() >= Date.parse(current.endAt))
        )
          throw new Error("Ingreso denegado: instantánea sin cobertura vigente");
        const event: OfflineEvent = {
          eventId: crypto.randomUUID(),
          type,
          folioExterno: folio.trim(),
          memberId: current.id,
          capturedAt: new Date().toISOString(),
          ...(type === "cobro_provisional" ? { amountCents: Number(amount), method } : {}),
          payload: JSON.stringify({
            permit: value.lease.permit,
            proof: current.proof,
            ...(type === "cobro_provisional" && method === "transbank"
              ? { reference: reference.trim(), comment: comment.trim() }
              : {}),
          }),
        };
        return { ...value, lastClock: Date.now(), events: [...value.events, event] };
      });
      setFolio("");
      setReference("");
      setComment("");
      toast.success(
        type === "cobro_provisional"
          ? "Cobro provisional guardado. Conserva el folio externo."
          : "Ingreso de contingencia guardado. Conserva el folio externo.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (syncBusy.current || !bundle) return;
    syncBusy.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!session) throw new Error("Inicia sesión con el operador para sincronizar");
      if (session.user.id !== bundle.lease.accountId)
        throw new Error("La copia pertenece a otro operador");
      const toSend = bundle.events;
      const response = toSend.length
        ? await api.offlineSync(bundle.lease.deviceId, toSend)
        : { results: [] };
      await updateVault((value) => {
        const acknowledged = new Set(response.results.map((r) => r.eventId));
        return {
          ...value,
          events: value.events.filter((e) => !acknowledged.has(e.eventId)),
          results: [
            ...value.results.filter((r) => !acknowledged.has(r.eventId)),
            ...response.results.map((result) => ({
              ...result,
              folioExterno:
                value.events.find((ev) => ev.eventId === result.eventId)?.folioExterno ??
                value.results.find((r) => r.eventId === result.eventId)?.folioExterno,
            })),
          ],
        };
      });
      toast.success("Eventos reconocidos por el servidor. Revisa los rechazos y pagos pendientes.");
      await revalidate();
    } catch (e) {
      setVerified(false);
      setError(
        e instanceof Error ? e.message : "No se pudo sincronizar; la copia local se conserva",
      );
    } finally {
      setBusy(false);
      syncBusy.current = false;
    }
  }
  // Reconnection must validate the server permission before any new offline action.
  useEffect(() => {
    if (!bundle || !online || verified || !session || busy) return;
    let active = true;
    void revalidate().catch((e) => {
      if (active) {
        if (e instanceof TypeError) {
          setReachable(false);
          setError(
            "Servidor sin conexión. Puedes operar con la instantánea vigente y folio externo.",
          );
        } else {
          setReachable(true);
          setError(e instanceof Error ? e.message : "No se pudo revalidar. Reintenta.");
        }
      }
    });
    return () => {
      active = false;
    };
  }, [online, activeId, session]); // Explicit transitions, not every encrypted write.
  const pending = bundle?.events.length ?? 0;
  const member = bundle?.lease.members.find((m) => m.id === memberId);
  const found =
    bundle?.lease.members
      .filter((m) => `${m.name} ${m.qrToken ?? ""}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 20) ?? [];
  let validity: string | null = null;
  if (bundle) {
    try {
      checkLease(
        bundle.lease,
        {
          accountId: session?.user.id ?? bundle.lease.accountId,
          organizationId: session?.organization.id ?? bundle.lease.organizationId,
        },
        Date.now(),
        bundle.lastClock,
      );
    } catch (e) {
      validity = e instanceof Error ? e.message : "Permiso no válido";
    }
  }
  async function exportVault() {
    if (!activeId) return;
    const saved = await getVault(activeId);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(saved)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "gym-contingencia-cifrada.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section>
      <PageHead
        eyebrow="Continuidad operativa"
        title="Contingencia"
        description="Prepara este equipo con conexión. Sin red, conserva cada cobro e ingreso con un folio externo."
        actions={
          bundle && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void exportVault()}>
                <Download className="h-4 w-4" />
                Exportar copia cifrada
              </Button>
              <Button variant="outline" onClick={() => setLockConfirm(true)}>
                <LockKeyhole className="h-4 w-4" />
                Bloquear
              </Button>
            </div>
          )
        }
      />
      <ErrorNotice message={error} />
      {validity && <ErrorNotice message={validity} />}{" "}
      {!bundle ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border bg-card p-6">
            <h2 className="font-semibold">Desbloquear copia local</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Usa la frase de contingencia. La copia sigue guardada al cerrar el navegador.
            </p>
            <form onSubmit={unlock} className="space-y-4">
              <Select
                id="vault-select"
                label="Dispositivo guardado"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                required
              >
                <option value="">Selecciona una copia</option>
                {envelopes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
              <div>
                <Label htmlFor="unlock-phrase">Frase local de contingencia</Label>
                <Input
                  id="unlock-phrase"
                  type="password"
                  minLength={12}
                  required
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={busy || !selectedId}>
                Desbloquear
              </Button>
            </form>
            <div className="mt-5 border-t pt-4">
              <label className="text-xs text-muted-foreground">
                Restaurar copia cifrada exportada
                <input
                  className="mt-2 block w-full text-xs"
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    void file
                      .text()
                      .then(async (text) => {
                        const env = JSON.parse(text) as Envelope;
                        if (!env.id || !env.label || env.version !== 1)
                          throw new Error("Copia no reconocida");
                        if (await getVault(env.id))
                          throw new Error(
                            "Ya existe una copia para este dispositivo. Expórtala antes de restaurar en otro perfil de navegador.",
                          );
                        await saveVault(env);
                        setEnvelopes(await listVaults());
                        setSelectedId(env.id);
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                />
              </label>
            </div>
          </article>
          {session ? (
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Preparar este equipo</h2>
              <p className="my-3 text-sm text-muted-foreground">
                Permiso máximo de 72 horas. Se verifica al reconectar y se bloquea al salir.
              </p>
              <p className="mb-4 text-xs text-muted-foreground">
                Política: {policy?.enabled ? "habilitada por administración" : "deshabilitada"}
              </p>
              <form onSubmit={prepare} className="space-y-4">
                <Select
                  id="device-select"
                  label="Dispositivo asignado a mi cuenta"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  required
                >
                  <option value="">Selecciona dispositivo</option>
                  {devices
                    .filter((d) => d.state === "habilitado")
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                </Select>
                <div>
                  <Label htmlFor="prepare-phrase">Frase local (mínimo 12 caracteres)</Label>
                  <Input
                    id="prepare-phrase"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Conserva la frase en un lugar seguro. Sin ella no se puede recuperar la copia.
                  </p>
                </div>
                <Button type="submit" disabled={busy || !deviceId || !policy?.enabled}>
                  Preparar contingencia
                </Button>
              </form>
            </article>
          ) : (
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Reconectar con el servidor</h2>
              <p className="my-3 text-sm text-muted-foreground">
                Inicia sesión para preparar o sincronizar este dispositivo.
              </p>
              <Link className="text-sm font-semibold text-primary" to="/login">
                Ir al inicio de sesión
              </Link>
            </article>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
            <div>
              <p className="font-semibold">
                {bundle.organizationName ?? "Gimnasio"} ·{" "}
                {online && reachable !== false ? "Red disponible" : "Sin conexión con el servidor"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Permiso hasta {new Date(bundle.lease.expiresAt).toLocaleString("es-CL")} · {pending}{" "}
                eventos pendientes
              </p>
            </div>
            <Button disabled={busy || !online || !session} onClick={() => void sync()}>
              <RefreshCw className="h-4 w-4" />
              Sincronizar y revalidar
            </Button>
          </article>
          <div className="grid gap-6 lg:grid-cols-2">
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Socios de la instantánea</h2>
              <Input
                className="my-4"
                type="search"
                aria-label="Buscar en instantánea"
                placeholder="Nombre o token QR…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select
                id="offline-member"
                label="Socio"
                value={memberId}
                onChange={(e) => {
                  setMemberId(e.target.value);
                  setAmount(
                    String(bundle.lease.members.find((m) => m.id === e.target.value)?.price ?? ""),
                  );
                }}
              >
                <option value="">Selecciona socio</option>
                {found.map((m: OfflineMember) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
              {member && (
                <div className="mt-4 rounded-lg bg-muted/40 p-4">
                  <p className="font-medium">{member.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {member.coverage === "none"
                      ? "Sin cobertura de ingreso"
                      : `Cobertura hasta ${member.endAt ? new Date(member.endAt).toLocaleDateString("es-CL") : "—"}`}
                  </p>
                </div>
              )}
            </article>
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Registrar contingencia</h2>
              <p className="my-3 text-xs leading-relaxed text-muted-foreground">
                Ningún cobro offline activa la membresía. Anota el folio también fuera de esta app
                para permitir reconstrucción.
              </p>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="offline-folio">Folio externo obligatorio</Label>
                  <Input
                    id="offline-folio"
                    value={folio}
                    onChange={(e) => setFolio(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="offline-amount">Monto (CLP)</Label>
                  <Input
                    id="offline-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <Select
                  id="offline-method"
                  label="Método"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                  <option value="transbank">Transbank externo</option>
                </Select>
                {method === "transbank" && (
                  <>
                    <div>
                      <Label htmlFor="offline-reference">Número de operación (obligatorio)</Label>
                      <Input
                        id="offline-reference"
                        maxLength={200}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="offline-comment">Comentario (obligatorio)</Label>
                      <Input
                        id="offline-comment"
                        maxLength={1000}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Cobro externo, sin datos de tarjeta"
                      />
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy || !member || !!validity || (online && reachable !== false && !verified)
                    }
                    onClick={() => void capture("cobro_provisional")}
                  >
                    Guardar cobro provisional
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy || !member || !!validity || (online && reachable !== false && !verified)
                    }
                    onClick={() => void capture("ingreso_contingencia")}
                  >
                    Registrar ingreso
                  </Button>
                </div>
              </div>
            </article>
          </div>
          <article className="rounded-2xl border bg-card p-6">
            <h2 className="font-semibold">Outbox y resultados</h2>
            <div className="mt-4 divide-y">
              {bundle.events.map((ev) => (
                <div key={ev.eventId} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
                  <span>
                    {ev.folioExterno} ·{" "}
                    {ev.type === "cobro_provisional"
                      ? `Cobro ${formatCLP(ev.amountCents ?? 0)}`
                      : "Ingreso"}
                  </span>
                  <span className="text-xs text-warning">Pendiente de sincronización</span>
                </div>
              ))}
              {bundle.results.map((r) => (
                <div key={r.eventId} className="py-3 text-xs">
                  {r.folioExterno && <p className="mb-1 font-semibold">{r.folioExterno}</p>}
                  <span
                    className={
                      r.status === "rechazado"
                        ? "text-destructive"
                        : r.status === "duplicado"
                          ? "text-warning"
                          : "text-success"
                    }
                  >
                    {r.status === "sincronizado"
                      ? "Reconocido por el servidor"
                      : r.status === "duplicado"
                        ? "Posible duplicado: requiere revisión"
                        : "Rechazado: requiere revisión"}
                  </span>
                  {r.reason && <p className="mt-1 text-muted-foreground">{r.reason}</p>}
                </div>
              ))}
              {!bundle.events.length && !bundle.results.length && (
                <p className="py-4 text-sm text-muted-foreground">Sin eventos locales todavía.</p>
              )}
            </div>
          </article>
        </div>
      )}
      {admin && !bundle && (
        <article className="mt-6 rounded-2xl border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Habilitación de dispositivos</h2>
            <Button variant="outline" onClick={() => setEnable(true)}>
              {policy?.enabled ? "Deshabilitar contingencia" : "Habilitar contingencia"}
            </Button>
          </div>
          <form
            className="mt-5 grid items-end gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api
                .registerDevice(operator, label.trim())
                .then(() => {
                  toast.success("Dispositivo habilitado");
                  setLabel("");
                  void load();
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <Select
              id="offline-operator"
              label="Operador"
              required
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
            >
              <option value="">Selecciona operador</option>
              {staff
                .filter((s) => s.role !== "instructor")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.role}
                  </option>
                ))}
            </Select>
            <div>
              <Label htmlFor="device-label">Nombre del dispositivo</Label>
              <Input
                id="device-label"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              Registrar dispositivo
            </Button>
          </form>
          <div className="mt-4 space-y-2">
            {allDevices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 border-t py-3 text-sm"
              >
                <span>
                  {d.label} · {staff.find((s) => s.id === d.accountId)?.name ?? "Operador"} ·{" "}
                  {d.state}
                </span>
                {d.state === "habilitado" && (
                  <Button variant="ghost" size="sm" onClick={() => setRevoke(d)}>
                    Revocar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </article>
      )}
      <Confirm
        open={enable}
        onOpenChange={setEnable}
        title={policy?.enabled ? "Deshabilitar contingencia" : "Habilitar contingencia"}
        description="Esta política controla los dispositivos prehabilitados de tu organización. El permiso es de hasta 72 horas; los cobros siempre quedan provisionales."
        onConfirm={() => {
          setBusy(true);
          void api
            .setOfflinePolicy(!policy?.enabled)
            .then(() => {
              setEnable(false);
              void load();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
        busy={busy}
      />
      <Confirm
        open={lockConfirm}
        onOpenChange={setLockConfirm}
        title="Bloquear copia local"
        description={`${pending} eventos pendientes se conservarán cifrados. Necesitarás la frase local para continuar.`}
        onConfirm={() => {
          lock();
          setLockConfirm(false);
        }}
      />
      <Confirm
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revocar dispositivo"
        description="Sus futuros eventos serán rechazados al reconectar y se conservarán para auditoría."
        destructive
        onConfirm={() => {
          if (!revoke) return;
          setBusy(true);
          void api
            .revokeDevice(revoke.id)
            .then(() => {
              setRevoke(null);
              void load();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
        busy={busy}
      />
    </section>
  );
}
