import type { OfflineEvent, OfflineLease, SyncResult } from "../api.js";
export interface VaultBundle {
  lease: OfflineLease;
  events: OfflineEvent[];
  results: (SyncResult & { folioExterno?: string })[];
  lastClock: number;
  organizationName?: string;
}
export interface Envelope {
  id: string;
  label: string;
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}
function b64(value: Uint8Array) {
  return btoa(Array.from(value, (x) => String.fromCharCode(x)).join(""));
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function key(phrase: string, salt: Uint8Array<ArrayBuffer>) {
  if (phrase.length < 12) throw new Error("Usa una frase de al menos 12 caracteres");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(phrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptBundle(value: unknown, phrase: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("gym-offline-v1") },
    await key(phrase, salt),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return {
    id: "",
    label: "",
    version: 1,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(cipher)),
  };
}
export async function decryptBundle(value: Envelope, phrase: string): Promise<VaultBundle> {
  if (value.version !== 1) throw new Error("Formato de contingencia no reconocido");
  try {
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(value.iv),
        additionalData: new TextEncoder().encode("gym-offline-v1"),
      },
      await key(phrase, bytes(value.salt)),
      bytes(value.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(clear)) as VaultBundle;
  } catch {
    throw new Error("Frase incorrecta o copia de contingencia dañada");
  }
}
export function checkLease(
  lease: OfflineLease,
  actor: { accountId: string; organizationId: string },
  now: number,
  lastClock: number,
) {
  if (lease.accountId !== actor.accountId || lease.organizationId !== actor.organizationId)
    throw new Error("Este dispositivo pertenece a otra cuenta u organización");
  const issued = Date.parse(lease.issuedAt),
    expires = Date.parse(lease.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires - issued > 72 * 3600000 ||
    now < issued - 60000 ||
    now > expires
  )
    throw new Error("Permiso de contingencia vencido. Revalida con conexión.");
  if (now < lastClock - 60000)
    throw new Error("El reloj del equipo retrocedió. Revalida con conexión.");
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("gym-offline-v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("vaults", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("No se pudo abrir el almacenamiento local"));
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vaults", mode),
      req = work(tx.objectStore("vaults"));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(new Error("No se pudo guardar la contingencia. Conserva el folio externo."));
    };
    tx.onabort = () => {
      db.close();
      reject(new Error("La escritura local fue cancelada"));
    };
  });
}
export const listVaults = () => transact<Envelope[]>("readonly", (s) => s.getAll());
export const getVault = (id: string) =>
  transact<Envelope | undefined>("readonly", (s) => s.get(id));
export const saveVault = (envelope: Envelope) =>
  transact<IDBValidKey>("readwrite", (s) => s.put(envelope));
export async function writeVault(id: string, label: string, bundle: VaultBundle, phrase: string) {
  const envelope = await encryptBundle(bundle, phrase);
  await saveVault({ ...envelope, id, label });
}
export async function withVaultLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks)
    throw new Error("Este navegador no soporta el bloqueo seguro de contingencia");
  return navigator.locks.request(`gym-vault-${id}`, { mode: "exclusive" }, action);
}
export function vaultId(lease: OfflineLease) {
  return `${lease.organizationId}:${lease.accountId}:${lease.deviceId}`;
}
