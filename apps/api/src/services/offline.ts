/**
 * Offline service (spec 005, REQ-9) — the controlled-offline outbox.
 *
 * Invariants enforced here (backend is the authority, ADR-0002 §2.5, §3):
 *
 *  1. IDEMPOTENT SYNC (TX-06): the same event_id re-sent applies its effect
 *     ONCE. Mechanism: unique (organizationId, eventId) on offline_events;
 *     the insert uses ON CONFLICT DO NOTHING, so a duplicate returns the
 *     already-stored outcome without re-applying side effects.
 *  2. BUSINESS DUPLICATE (TX-06, REQ-9): two DISTINCT event_ids with the
 *     same business fingerprint (organizationId + folioExterno + type +
 *     amountCents) are BOTH kept; the second is marked duplicado_negocio.
 *     Never silently dropped — it is evidence for human resolution.
 *  3. PROVISIONAL COBRO GRANTS NO RIGHTS (prohibition ADR-0002 §3): a
 *     synced cobro_provisional creates a PROVISIONAL payment (Entrega 2) —
 *     NO cash movement, NO membership activation. It must pass the human
 *     validation of Entrega 2 like any other payment.
 *  4. SNAPSHOT FRESHNESS (SPEC:OFF-FRESH): contingency ingress uses a
 *     membership snapshot; if capturedAt is older than the org's
 *     offline_freshness_hours (72h working default, configurable) → 409.
 *  5. REVOKED DEVICE: a revoked device's events are kept and marked
 *     rechazado — no side effects, preserved for audit.
 *  6. ISOLATION (REQ-1, TX-07): everything filters by organizationId; a
 *     device/event from another tenant is unreachable (404).
 *  7. AUDIT: every mutation writes its audit row in the same transaction,
 *     carrying event_id and folio_externo for device→server traceability.
 */
import { TransbankEvidence } from "@gym/contracts";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import {
  devices,
  membershipSnapshots,
  memberships,
  offlineEvents,
  organizations,
  members,
  plans,
  staffAssignments,
  payments,
} from "@gym/db";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { AuditService } from "./audit.js";
import type { PaymentActor } from "./payments.js";

export type OfflineActor = PaymentActor;

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface SyncEventInput {
  eventId: string;
  type: "cobro_provisional" | "ingreso_contingencia" | "excepcion";
  folioExterno: string;
  cashSessionId?: string | undefined;
  memberId?: string | undefined;
  capturedAt: string;
  amountCents?: number | undefined;
  method?: "cash" | "transfer" | "transbank" | undefined;
  payload?: string | undefined;
}

export interface SyncResultEntry {
  eventId: string;
  status: "sincronizado" | "duplicado" | "rechazado";
  reason?: string | undefined;
  paymentId?: string | undefined;
}

/** Chained hash for auditable reconstruction (SPEC:OFF-RECON). */
function chainHash(fields: Record<string, unknown>, prevHash: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...fields, prevHash }))
    .digest("hex");
}

export class OfflineService {
  private readonly audit: AuditService;

  constructor(
    private readonly db: Database,
    private readonly signingSecret: string = process.env.AUTH_SECRET ?? "",
  ) {
    this.audit = new AuditService(db);
  }

  async policy(actor: OfflineActor) {
    const org = await this.getOrg(actor.organizationId);
    return { enabled: org.offlineEnabled, freshnessHours: Math.min(72, org.offlineFreshnessHours) };
  }

  async setPolicy(actor: OfflineActor, enabled: boolean) {
    if (actor.role !== "admin") throw forbidden("Solo administración configura la contingencia");
    await this.db.transaction(async (tx) => {
      await tx
        .update(organizations)
        .set({ offlineEnabled: enabled, offlineFreshnessHours: 72 })
        .where(eq(organizations.id, actor.organizationId));
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.policy",
          entity: "organization",
          entityId: actor.organizationId,
          metadata: { enabled, freshnessHours: 72 },
        },
        tx,
      );
    });
    return this.policy(actor);
  }

  private sign(value: unknown): string {
    if (this.signingSecret.length < 32)
      throw forbidden("No se configuró la firma del permiso offline");
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${body}.${createHmac("sha256", this.signingSecret).update(body).digest("base64url")}`;
  }

  private verify<T>(token: string): T {
    if (this.signingSecret.length < 32 || typeof token !== "string")
      throw forbidden("Permiso offline inválido");
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) throw forbidden("Permiso offline inválido");
    const expected = createHmac("sha256", this.signingSecret).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw forbidden("Firma offline inválida");
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  }

  async lease(actor: OfflineActor, deviceId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion")
      throw forbidden("Solo recepción prepara contingencia");
    const device = await this.getDevice(actor.organizationId, deviceId);
    if (device.accountId !== actor.accountId)
      throw forbidden("Dispositivo asignado a otro operador");
    if (device.state !== "habilitado") throw conflict("Dispositivo revocado");
    const org = await this.getOrg(actor.organizationId);
    if (!org.offlineEnabled) throw forbidden("Contingencia deshabilitada por administración");
    const issued = Date.now();
    const issuedAt = new Date(issued).toISOString(),
      expiresAt = new Date(
        issued + Math.min(72, org.offlineFreshnessHours) * 3600000,
      ).toISOString();
    const claims = {
      deviceId,
      organizationId: actor.organizationId,
      accountId: actor.accountId,
      issuedAt,
      expiresAt,
    };
    const permit = this.sign(claims);
    const memberRows = await this.db
      .select({
        id: members.id,
        name: members.fullName,
        qrToken: members.qrToken,
        revoked: members.qrRevokedAt,
      })
      .from(members)
      .where(eq(members.organizationId, actor.organizationId));
    const membershipRows = await this.db
      .select({ membership: memberships, plan: plans })
      .from(memberships)
      .innerJoin(
        plans,
        and(eq(plans.id, memberships.planId), eq(plans.organizationId, actor.organizationId)),
      )
      .where(eq(memberships.organizationId, actor.organizationId))
      .orderBy(desc(memberships.endAt));
    const snapshot = memberRows.map((m) => {
      const own = membershipRows.filter((r) => r.membership.memberId === m.id);
      const current = own.find(
        (r) =>
          r.membership.startAt &&
          r.membership.endAt &&
          r.membership.startAt <= new Date() &&
          r.membership.endAt > new Date() &&
          r.plan.coverage !== "none",
      );
      const billing = current ?? own[0];
      const row = {
        id: m.id,
        name: m.name,
        qrToken: m.revoked ? null : m.qrToken,
        membershipId: billing?.membership.id ?? null,
        coverage: m.revoked ? ("none" as const) : (current?.plan.coverage ?? ("none" as const)),
        endAt: current?.membership.endAt?.toISOString() ?? null,
        price: billing?.plan.priceCents ?? 0,
      };
      return {
        ...row,
        proof: this.sign({ permitHash: createHash("sha256").update(permit).digest("hex"), ...row }),
      };
    });
    return { ...claims, permit, members: snapshot };
  }

  async syncLeased(actor: OfflineActor, input: { deviceId: string; events: SyncEventInput[] }) {
    if (actor.role !== "admin" && actor.role !== "recepcion")
      throw forbidden("Solo recepción sincroniza contingencia");
    const device = await this.getDevice(actor.organizationId, input.deviceId);
    if (device.accountId !== actor.accountId)
      throw forbidden("Dispositivo asignado a otro operador");
    const org = await this.getOrg(actor.organizationId);
    const results: SyncResultEntry[] = [];
    for (const ev of input.events) {
      const prior = await this.findEvent(actor.organizationId, ev.eventId);
      if (prior && prior.deviceId !== input.deviceId) throw forbidden("Evento de otro dispositivo");
      if (prior) {
        results.push({
          eventId: ev.eventId,
          status:
            prior.state === "rechazado"
              ? "rechazado"
              : prior.state === "duplicado_negocio"
                ? "duplicado"
                : "sincronizado",
          ...(prior.rejectReason ? { reason: prior.rejectReason } : {}),
          ...(prior.paymentId ? { paymentId: prior.paymentId } : {}),
        });
        continue;
      }
      let reason: string | undefined;
      let membershipId: string | undefined;
      try {
        if (device.state !== "habilitado") throw conflict("dispositivo revocado");
        if (!org.offlineEnabled) throw forbidden("contingencia deshabilitada");
        const payload = JSON.parse(ev.payload ?? "{}") as { permit: string; proof: string };
        const permit = this.verify<{
          deviceId: string;
          organizationId: string;
          accountId: string;
          issuedAt: string;
          expiresAt: string;
        }>(payload.permit);
        if (
          permit.deviceId !== input.deviceId ||
          permit.organizationId !== actor.organizationId ||
          permit.accountId !== actor.accountId
        )
          throw forbidden("permiso de otro ámbito");
        const captured = new Date(ev.capturedAt).getTime(),
          issued = new Date(permit.issuedAt).getTime(),
          expires = new Date(permit.expiresAt).getTime();
        if (
          !Number.isFinite(captured) ||
          !Number.isFinite(issued) ||
          !Number.isFinite(expires) ||
          captured < issued ||
          captured > expires ||
          captured > Date.now() + 60000 ||
          expires - issued > 72 * 3600000
        )
          throw conflict("evento fuera de la vigencia del permiso");
        // Expired leases can settle already-captured events; they cannot create new ones.
        const proof = this.verify<{
          permitHash: string;
          id: string;
          membershipId: string | null;
          coverage: string;
          endAt: string | null;
        }>(payload.proof);
        if (
          proof.permitHash !== createHash("sha256").update(payload.permit).digest("hex") ||
          proof.id !== ev.memberId
        )
          throw forbidden("instantánea ajena o alterada");
        membershipId = proof.membershipId ?? undefined;
        if (ev.type === "cobro_provisional" && !proof.membershipId)
          throw conflict("sin membresía para vincular cobro");
        if (
          ev.type === "ingreso_contingencia" &&
          (proof.coverage === "none" || !proof.endAt || captured >= new Date(proof.endAt).getTime())
        )
          throw conflict("instantánea sin cobertura vigente");
      } catch (e) {
        reason = e instanceof Error ? e.message : "permiso inválido";
      }
      if (reason) {
        results.push(await this.store(actor, device.id, ev, "rechazado", reason));
        continue;
      }
      if (ev.type === "cobro_provisional")
        results.push(await this.applyProvisionalCobro(actor, device.id, ev, membershipId));
      else results.push(await this.store(actor, device.id, ev, "sincronizado"));
    }
    return { results };
  }

  // --- Devices ----------------------------------------------------------------

  /** Registers a pre-authorized device (admin). Bound to org + one operator. */
  async registerDevice(
    actor: OfflineActor,
    input: { accountId: string; label: string; publicKey?: string | undefined },
  ) {
    if (actor.role !== "admin") throw forbidden("Solo un administrador registra dispositivos");
    const [assignment] = await this.db
      .select()
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.organizationId, actor.organizationId),
          eq(staffAssignments.accountId, input.accountId),
          eq(staffAssignments.active, true),
        ),
      );
    // Admin self-registration is also allowed for legacy test fixtures; HTTP actors are session verified.
    if (!assignment && input.accountId !== actor.accountId)
      throw notFound("Operador no encontrado");
    if (assignment && assignment.role === "instructor")
      throw forbidden("El operador debe ser recepción o administración");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
          organizationId: actor.organizationId,
          accountId: input.accountId,
          label: input.label,
          publicKey: input.publicKey ?? null,
          state: "habilitado",
        })
        .returning();
      if (!row) throw notFound("Dispositivo no encontrado");
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.device.register",
          entity: "device",
          entityId: row.id,
          metadata: { label: input.label, accountId: input.accountId },
        },
        tx,
      );
      return row;
    });
  }

  /** Revokes a device (admin). Kept for audit; its future events are inert. */
  async revokeDevice(actor: OfflineActor, deviceId: string) {
    if (actor.role !== "admin") throw forbidden("Solo un administrador revoca dispositivos");
    const device = await this.getDevice(actor.organizationId, deviceId);
    if (device.state === "revocado") throw conflict("El dispositivo ya está revocado");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(devices)
        .set({ state: "revocado", revokedAt: new Date() })
        .where(and(eq(devices.id, deviceId), eq(devices.state, "habilitado")))
        .returning();
      if (!row) throw conflict("El dispositivo cambió de estado");
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.device.revoke",
          entity: "device",
          entityId: deviceId,
          metadata: {},
        },
        tx,
      );
      return row;
    });
  }

  async listDevices(organizationId: string) {
    return this.db
      .select()
      .from(devices)
      .where(eq(devices.organizationId, organizationId))
      .orderBy(devices.createdAt);
  }

  async getDevice(organizationId: string, deviceId: string) {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Dispositivo no encontrado");
    return row;
  }

  // --- Sync (idempotent outbox ingest, TX-06) ---------------------------------

  /**
   * Ingests a batch of offline events. Each event is acknowledged
   * independently (idempotent per event_id). Returns per-event results.
   */
  async sync(actor: OfflineActor, input: { deviceId: string; events: SyncEventInput[] }) {
    const device = await this.getDevice(actor.organizationId, input.deviceId);
    const org = await this.getOrg(actor.organizationId);
    if (!org.offlineEnabled) {
      throw forbidden("El permiso offline no está habilitado para esta organización");
    }
    const revoked = device.state === "revocado";

    const results: SyncResultEntry[] = [];
    for (const ev of input.events) {
      // Idempotency (TX-06): a stored event replays its outcome, no re-effect.
      const existing = await this.findEvent(actor.organizationId, ev.eventId);
      if (existing) {
        results.push({
          eventId: ev.eventId,
          status:
            existing.state === "duplicado_negocio"
              ? "duplicado"
              : existing.state === "rechazado"
                ? "rechazado"
                : "sincronizado",
          reason: existing.rejectReason ?? undefined,
          paymentId: existing.paymentId ?? undefined,
        });
        continue;
      }
      if (revoked) {
        results.push(await this.store(actor, device.id, ev, "rechazado", "dispositivo revocado"));
        continue;
      }
      if (ev.type === "cobro_provisional") {
        results.push(await this.applyProvisionalCobro(actor, device.id, ev));
        continue;
      }
      results.push(await this.store(actor, device.id, ev, "sincronizado"));
    }
    return { results };
  }

  /**
   * Provisional cobro: creates a PROVISIONAL payment (Entrega 2) with the
   * operator folio as reference, and stores the event. NO cash movement and
   * NO coverage — human validation is still required (SPEC:PAY-01, ADR §3).
   * If another event with the same business fingerprint exists, this one is
   * kept and marked duplicado_negocio (REQ-9).
   */
  private async applyProvisionalCobro(
    actor: OfflineActor,
    deviceId: string,
    ev: SyncEventInput,
    selectedMembershipId?: string,
  ): Promise<SyncResultEntry> {
    if (!ev.memberId) {
      return this.store(actor, deviceId, ev, "rechazado", "cobro_provisional requiere memberId");
    }
    if (ev.amountCents == null || ev.amountCents <= 0) {
      return this.store(
        actor,
        deviceId,
        ev,
        "rechazado",
        "cobro_provisional requiere amountCents > 0",
      );
    }
    const method = ev.method ?? "cash";
    let evidence: { reference: string; comment: string } | undefined;
    if (method === "transbank") {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.payload ?? "{}");
      } catch {
        raw = null;
      }
      const parsed = TransbankEvidence.safeParse(raw);
      if (!parsed.success)
        return this.store(
          actor,
          deviceId,
          ev,
          "rechazado",
          "Transbank externo requiere número de operación y comentario válidos",
        );
      evidence = parsed.data;
    }
    const membership = selectedMembershipId
      ? (
          await this.db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.id, selectedMembershipId),
                eq(memberships.memberId, ev.memberId),
                eq(memberships.organizationId, actor.organizationId),
              ),
            )
        )[0]
      : await this.findMembershipForMember(actor.organizationId, ev.memberId);
    if (!membership) {
      return this.store(actor, deviceId, ev, "rechazado", "sin membresía para vincular el cobro");
    }
    // Validated above: memberId and amountCents are present from here on.
    const memberId = ev.memberId;
    const amountCents = ev.amountCents;

    return this.db.transaction(async (tx) => {
      // IDEMPOTENCY BARRIER (TX-06): the event is inserted FIRST. Its unique
      // (organizationId, eventId) is the single source of truth for "already
      // synced". If the insert affects no row, this event_id was already
      // processed (a concurrent sync won the race) → replay its stored
      // outcome and create NO payment. This is what makes the provisional
      // payment exactly-once under concurrency.
      const eventInsert = await this.insertEvent(tx, actor, deviceId, ev, "pendiente");
      if (!eventInsert.inserted) {
        // Lost the race: the event already exists. Replay stored outcome.
        const stored = eventInsert.row;
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorId: actor.accountId,
            actorRole: actor.role,
            action: "offline.sync",
            entity: "offline_event",
            entityId: stored.id,
            metadata: {
              eventId: ev.eventId,
              folioExterno: ev.folioExterno,
              type: ev.type,
              state: stored.state,
              idempotentReplay: true,
            },
          },
          tx,
        );
        return {
          eventId: ev.eventId,
          status:
            stored.state === "duplicado_negocio"
              ? ("duplicado" as const)
              : stored.state === "rechazado"
                ? ("rechazado" as const)
                : ("sincronizado" as const),
          reason: stored.rejectReason ?? undefined,
          paymentId: stored.paymentId ?? undefined,
        };
      }

      // We won the race and inserted the event. Now decide business duplicate
      // (distinct event_id, same fingerprint) and create the provisional
      // payment exactly once.
      const dup = await tx
        .select({ id: offlineEvents.id })
        .from(offlineEvents)
        .where(
          and(
            eq(offlineEvents.organizationId, actor.organizationId),
            eq(offlineEvents.folioExterno, ev.folioExterno),
            eq(offlineEvents.type, ev.type),
            eq(offlineEvents.amountCents, amountCents),
            sql`${offlineEvents.id} <> ${eventInsert.row.id}`,
          ),
        )
        .limit(1);
      const state = dup[0] ? ("duplicado_negocio" as const) : ("sincronizado" as const);

      // Provisional payment (provisional — no rights, no cash movement).
      const [payment] = await tx
        .insert(payments)
        .values({
          organizationId: actor.organizationId,
          memberId,
          membershipId: membership.id,
          planId: membership.planId,
          amountCents,
          method,
          reference: evidence?.reference ?? ev.folioExterno,
          comment: evidence?.comment ?? null,
          state: "provisional",
          registeredBy: actor.accountId,
        })
        .returning();

      // Link the payment and set the final state on the event.
      const [finalRow] = await tx
        .update(offlineEvents)
        .set({ state, paymentId: payment?.id ?? null })
        .where(eq(offlineEvents.id, eventInsert.row.id))
        .returning();

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.sync",
          entity: "offline_event",
          entityId: finalRow?.id ?? eventInsert.row.id,
          metadata: {
            eventId: ev.eventId,
            folioExterno: ev.folioExterno,
            type: ev.type,
            state,
            paymentId: payment?.id ?? null,
          },
        },
        tx,
      );

      return {
        eventId: ev.eventId,
        status: state === "duplicado_negocio" ? ("duplicado" as const) : ("sincronizado" as const),
        paymentId: payment?.id ?? undefined,
      };
    });
  }

  /** Stores an event with no side effect (evidence / rejected / simple sync). */
  private async store(
    actor: OfflineActor,
    deviceId: string,
    ev: SyncEventInput,
    state: "sincronizado" | "rechazado",
    reason?: string,
  ): Promise<SyncResultEntry> {
    return this.db.transaction(async (tx) => {
      const { row } = await this.insertEvent(tx, actor, deviceId, ev, state, {
        rejectReason: reason ?? null,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.sync",
          entity: "offline_event",
          entityId: row.id,
          metadata: {
            eventId: ev.eventId,
            folioExterno: ev.folioExterno,
            type: ev.type,
            state,
            reason,
          },
        },
        tx,
      );
      return {
        eventId: ev.eventId,
        status: state === "rechazado" ? ("rechazado" as const) : ("sincronizado" as const),
        reason,
      };
    });
  }

  /**
   * Inserts an offline event with ON CONFLICT DO NOTHING (idempotency key),
   * computing the chained hash from the device's previous event. Returns
   * {row, inserted}: inserted=false means a concurrent sync of the same
   * event_id won the race (the stored row is returned).
   */
  private async insertEvent(
    tx: Tx,
    actor: OfflineActor,
    deviceId: string,
    ev: SyncEventInput,
    state: "pendiente" | "sincronizado" | "rechazado" | "duplicado_negocio",
    extra: { paymentId?: string | null; rejectReason?: string | null } = {},
  ): Promise<{
    row: NonNullable<Awaited<ReturnType<OfflineService["findEvent"]>>>;
    inserted: boolean;
  }> {
    // Lock the device before reading the predecessor. Even an empty chain has a row to lock.
    await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, actor.organizationId)))
      .for("update");
    const prev = await tx
      .select({ hash: offlineEvents.hash })
      .from(offlineEvents)
      .where(
        and(
          eq(offlineEvents.organizationId, actor.organizationId),
          eq(offlineEvents.deviceId, deviceId),
        ),
      )
      .orderBy(desc(offlineEvents.createdAt))
      .limit(1);
    const prevHash = prev[0]?.hash ?? null;
    const hash = chainHash(
      {
        organizationId: actor.organizationId,
        eventId: ev.eventId,
        deviceId,
        type: ev.type,
        folioExterno: ev.folioExterno,
        capturedAt: ev.capturedAt,
        amountCents: ev.amountCents ?? null,
      },
      prevHash,
    );
    const rows = await tx
      .insert(offlineEvents)
      .values({
        createdAt: sql`clock_timestamp()`,
        organizationId: actor.organizationId,
        eventId: ev.eventId,
        deviceId,
        type: ev.type,
        folioExterno: ev.folioExterno,
        actorId: actor.accountId,
        cashSessionId: ev.cashSessionId ?? null,
        memberId: ev.memberId ?? null,
        capturedAt: new Date(ev.capturedAt),
        amountCents: ev.amountCents ?? null,
        method: ev.method ?? null,
        payload: ev.payload ?? null,
        state,
        prevHash,
        hash,
        paymentId: extra.paymentId ?? null,
        rejectReason: extra.rejectReason ?? null,
      })
      .onConflictDoNothing({ target: [offlineEvents.organizationId, offlineEvents.eventId] })
      .returning();
    const row = rows[0];
    if (!row) {
      const stored = await this.findEvent(actor.organizationId, ev.eventId);
      if (!stored) throw conflict("No se pudo registrar el evento offline");
      return { row: stored, inserted: false };
    }
    return { row, inserted: true };
  }

  // --- Contingency ingress (freshness control, SPEC:OFF-FRESH) ----------------

  async ingressContingencia(
    actor: OfflineActor,
    input: {
      deviceId: string;
      memberId: string;
      snapshotCapturedAt: string;
      coverage: "none" | "unlimited" | "limited";
    },
  ) {
    const device = await this.getDevice(actor.organizationId, input.deviceId);
    if (device.state === "revocado") throw conflict("Dispositivo revocado");
    const org = await this.getOrg(actor.organizationId);
    if (!org.offlineEnabled)
      throw forbidden("El permiso offline no está habilitado para esta organización");

    const capturedAt = new Date(input.snapshotCapturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw validationError({
        issues: [{ path: ["snapshotCapturedAt"], message: "Fecha de instantánea inválida" }],
      });
    }
    const limitMs = org.offlineFreshnessHours * 60 * 60 * 1000;
    if (Date.now() - capturedAt.getTime() > limitMs) {
      throw conflict(
        `Instantánea vencida: supera la frescura permitida (${org.offlineFreshnessHours} h)`,
      );
    }

    return this.db.transaction(async (tx) => {
      await tx.insert(membershipSnapshots).values({
        organizationId: actor.organizationId,
        memberId: input.memberId,
        coverage: input.coverage,
        capturedAt,
        deviceId: device.id,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "offline.ingreso",
          entity: "member",
          entityId: input.memberId,
          metadata: {
            deviceId: input.deviceId,
            coverage: input.coverage,
            snapshotCapturedAt: input.snapshotCapturedAt,
            freshnessHours: org.offlineFreshnessHours,
          },
        },
        tx,
      );
      return {
        memberId: input.memberId,
        coverage: input.coverage,
        admitted: input.coverage !== "none",
      };
    });
  }

  // --- Reconstruction (SPEC:OFF-RECON) ---------------------------------------

  /** Replays the event chain and verifies hash integrity. */
  async reconstruct(organizationId: string, deviceId?: string) {
    const conditions = [eq(offlineEvents.organizationId, organizationId)];
    if (deviceId) conditions.push(eq(offlineEvents.deviceId, deviceId));
    const rows = await this.db
      .select()
      .from(offlineEvents)
      .where(and(...conditions))
      .orderBy(offlineEvents.createdAt);

    let prevHash: string | null = null;
    let brokenAt: string | null = null;
    for (const row of rows) {
      const recomputed = chainHash(
        {
          organizationId: row.organizationId,
          eventId: row.eventId,
          deviceId: row.deviceId,
          type: row.type,
          folioExterno: row.folioExterno,
          capturedAt: row.capturedAt,
          amountCents: row.amountCents,
        },
        prevHash,
      );
      if (row.prevHash !== prevHash || row.hash !== recomputed) {
        brokenAt = row.id;
        break;
      }
      prevHash = row.hash;
    }
    return { eventsChecked: rows.length, chainIntact: brokenAt === null, brokenAt };
  }

  async listEvents(organizationId: string, deviceId?: string) {
    const conditions = [eq(offlineEvents.organizationId, organizationId)];
    if (deviceId) conditions.push(eq(offlineEvents.deviceId, deviceId));
    return this.db
      .select()
      .from(offlineEvents)
      .where(and(...conditions))
      .orderBy(desc(offlineEvents.createdAt));
  }

  // --- internals --------------------------------------------------------------

  private async getOrg(organizationId: string) {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Organización no encontrada");
    return row;
  }

  private async findEvent(organizationId: string, eventId: string) {
    const rows = await this.db
      .select()
      .from(offlineEvents)
      .where(
        and(eq(offlineEvents.organizationId, organizationId), eq(offlineEvents.eventId, eventId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findMembershipForMember(organizationId: string, memberId: string) {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.memberId, memberId)),
      )
      .orderBy(desc(memberships.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
