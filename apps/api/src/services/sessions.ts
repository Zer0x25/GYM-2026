/**
 * Sessions service (spec 004) — class templates, sessions and the unified
 * instructor agenda.
 *
 * Invariants (backend is the authority, ADR-0002 §3):
 *  1. No instructor may hold two commitments that overlap in time
 *     (grupal + fija + cita + bloqueo) → TX-02 / REQ-6.
 *  2. Every read/write filters by organizationId (REQ-1, TX-07): a session
 *     from another tenant behaves as not-found (no existence leak).
 *  3. Every mutation writes its audit row in the same transaction.
 */
import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import { classTemplates, sessions } from "@gym/db";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { BookingsService } from "./bookings.js";
import { AuditService } from "./audit.js";

export interface SessionActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export interface CreateSessionInput {
  templateId?: string | undefined;
  type: "grupal" | "fija" | "cita" | "bloqueo";
  instructorId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}

export class SessionsService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  // --- Class templates (admin only) -----------------------------------------

  async createTemplate(
    actor: SessionActor,
    input: {
      name: string;
      type: "grupal" | "fija";
      capacity: number;
      reservationWindowHours?: number;
      cancellationWindowHours?: number;
      coverageRequired?: "none" | "unlimited" | "limited";
    },
  ) {
    if (actor.role !== "admin") throw forbidden("Solo un administrador crea plantillas de clase");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(classTemplates)
        .values({
          organizationId: actor.organizationId,
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          reservationWindowHours: input.reservationWindowHours ?? 0,
          cancellationWindowHours: input.cancellationWindowHours ?? 24,
          coverageRequired: input.coverageRequired ?? "unlimited",
        })
        .returning();
      if (!row) throw notFound("Plantilla no encontrada");
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "class_template.create",
          entity: "class_template",
          entityId: row.id,
          metadata: { name: input.name, type: input.type, capacity: input.capacity },
        },
        tx,
      );
      return row;
    });
  }

  async listTemplates(organizationId: string) {
    return this.db
      .select()
      .from(classTemplates)
      .where(eq(classTemplates.organizationId, organizationId))
      .orderBy(classTemplates.name);
  }

  // --- Sessions ---------------------------------------------------------------

  /**
   * Creates a session (grupal/fija/cita/bloqueo). Rejects any real overlap
   * with an existing scheduled commitment of the same instructor (TX-02).
   * The `SELECT ... FOR UPDATE` on conflicting rows serializes two racing
   * creates so both cannot pass the overlap check.
   */
  async create(actor: SessionActor, input: CreateSessionInput) {
    if (input.endsAt <= input.startsAt) {
      throw validationError({
        issues: [{ path: ["endsAt"], message: "El fin debe ser posterior al inicio" }],
      });
    }
    if (input.type === "bloqueo" && actor.role === "socio") {
      throw forbidden("Un socio no crea bloqueos de agenda");
    }

    return this.db.transaction(async (tx) => {
      // A row lock cannot protect an empty agenda. Serialize by tenant + instructor first.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":" + input.instructorId}, 0))`,
      );
      const overlap = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, actor.organizationId),
            eq(sessions.instructorId, input.instructorId),
            eq(sessions.state, "programada"),
            lt(sessions.startsAt, input.endsAt),
            gt(sessions.endsAt, input.startsAt),
          ),
        )
        .for("update")
        .limit(1);
      if (overlap[0]) {
        throw conflict("El instructor ya tiene un compromiso que se solapa en ese horario");
      }

      const [row] = await tx
        .insert(sessions)
        .values({
          organizationId: actor.organizationId,
          templateId: input.templateId ?? null,
          type: input.type,
          instructorId: input.instructorId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          capacity: input.type === "bloqueo" ? 0 : input.capacity,
          state: "programada",
          createdBy: actor.accountId,
        })
        .returning();
      if (!row) throw notFound("Sesión no encontrada");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.create",
          entity: "session",
          entityId: row.id,
          metadata: {
            type: input.type,
            instructorId: input.instructorId,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
          },
        },
        tx,
      );

      return row;
    });
  }

  /** Cancels a session (el gimnasio cancela). Bookings keep their own policy. */
  async cancel(actor: SessionActor, sessionId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion") throw forbidden();
    const session = await this.getById(actor.organizationId, sessionId);
    if (session.state === "cancelada") throw conflict("La sesión ya está cancelada");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({ state: "cancelada" })
        .where(and(eq(sessions.id, sessionId), eq(sessions.state, "programada")))
        .returning();
      if (!row) throw conflict("La sesión cambió de estado");
      await new BookingsService(this.db).cancelForSession(tx, actor, sessionId);
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.cancel",
          entity: "session",
          entityId: sessionId,
          metadata: {},
        },
        tx,
      );
      return row;
    });
  }

  async getById(organizationId: string, sessionId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Sesión no encontrada");
    return row;
  }

  /** Bookable sessions of the org within a time range (portal/recepción). */
  async listBookable(organizationId: string, from: Date, to: Date) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.organizationId, organizationId),
          eq(sessions.state, "programada"),
          or(eq(sessions.type, "grupal"), eq(sessions.type, "fija"), eq(sessions.type, "cita")),
          gt(sessions.startsAt, from),
          lt(sessions.startsAt, to),
        ),
      )
      .orderBy(sessions.startsAt);
  }

  /**
   * Unified instructor agenda (REQ-6): every commitment of the instructor
   * in a range, merged regardless of type. No overlap can exist (enforced
   * at create time), so this is a coherent timeline.
   */
  async agenda(organizationId: string, instructorId: string, from: Date, to: Date) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.organizationId, organizationId),
          eq(sessions.instructorId, instructorId),
          gt(sessions.startsAt, from),
          lt(sessions.startsAt, to),
        ),
      )
      .orderBy(sessions.startsAt);
  }
}
