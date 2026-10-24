import { TRPCError } from "@trpc/server";
import { and, eq, gt, gte, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  appointmentStatusValues,
  appointments,
  clients,
  patients,
  users,
} from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const DURATION_MIN_MINUTES = 5;
const DURATION_MAX_MINUTES = 480;
const NOTES_MAX_LENGTH = 2000;

const staffBook = protectedProcedure.use(
  requireRole("admin", "veterinarian", "front_desk"),
);

const dateTime = z.string().datetime({ offset: true });

const notesInput = z
  .string()
  .trim()
  .max(NOTES_MAX_LENGTH)
  .optional()
  .transform((value) => value || undefined);

const listInput = z
  .object({
    startDate: dateTime,
    endDate: dateTime,
    doctorId: z.string().uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (new Date(input.endDate) < new Date(input.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be on or after start date.",
      });
    }
  });

const createInput = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  startTime: dateTime,
  endTime: dateTime,
  notes: notesInput,
});

function timeRange(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (end <= start) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "End time must be after start time.",
    });
  }
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (minutes < DURATION_MIN_MINUTES || minutes > DURATION_MAX_MINUTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Appointment duration must be between ${DURATION_MIN_MINUTES} and ${DURATION_MAX_MINUTES} minutes.`,
    });
  }
  return { start, end };
}

const appointmentColumns = {
  id: appointments.id,
  startTime: appointments.startTime,
  endTime: appointments.endTime,
  status: appointments.status,
  notes: appointments.notes,
  patientId: appointments.patientId,
  patientName: patients.name,
  clientId: appointments.clientId,
  clientFirstName: clients.firstName,
  clientLastName: clients.lastName,
  doctorId: appointments.doctorId,
  doctorName: users.name,
};

export const appointmentsRouter = createRouter({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const conditions = [
      eq(appointments.practiceId, ctx.practiceId),
      isNull(appointments.deletedAt),
      gte(appointments.startTime, new Date(input.startDate)),
      lte(appointments.startTime, new Date(input.endDate)),
    ];
    if (input.doctorId) {
      conditions.push(eq(appointments.doctorId, input.doctorId));
    }

    return ctx.db
      .select(appointmentColumns)
      .from(appointments)
      .leftJoin(
        patients,
        and(
          eq(appointments.patientId, patients.id),
          eq(patients.clientId, appointments.clientId),
          eq(patients.practiceId, ctx.practiceId),
          isNull(patients.deletedAt),
        ),
      )
      .leftJoin(
        clients,
        and(
          eq(appointments.clientId, clients.id),
          eq(clients.practiceId, ctx.practiceId),
          isNull(clients.deletedAt),
        ),
      )
      .leftJoin(
        users,
        and(
          eq(appointments.doctorId, users.id),
          eq(users.practiceId, ctx.practiceId),
        ),
      )
      .where(and(...conditions))
      .orderBy(appointments.startTime);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [appointment] = await ctx.db
        .select(appointmentColumns)
        .from(appointments)
        .leftJoin(
          patients,
          and(
            eq(appointments.patientId, patients.id),
            eq(patients.clientId, appointments.clientId),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .leftJoin(
          clients,
          and(
            eq(appointments.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .leftJoin(
          users,
          and(
            eq(appointments.doctorId, users.id),
            eq(users.practiceId, ctx.practiceId),
          ),
        )
        .where(
          and(
            eq(appointments.id, input.id),
            eq(appointments.practiceId, ctx.practiceId),
            isNull(appointments.deletedAt),
          ),
        )
        .limit(1);
      if (!appointment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Appointment not found",
        });
      }
      return appointment;
    }),

  listDoctors: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.practiceId, ctx.practiceId),
          eq(users.isVeterinarian, true),
          isNull(users.deletedAt),
        ),
      );
  }),

  create: staffBook.input(createInput).mutation(async ({ ctx, input }) => {
    const { start, end } = timeRange(input.startTime, input.endTime);

    return ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${ctx.practiceId}))`,
      );

      const [patient] = await tx
        .select({ id: patients.id, clientId: patients.clientId })
        .from(patients)
        .innerJoin(
          clients,
          and(
            eq(clients.id, patients.clientId),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .where(
          and(
            eq(patients.id, input.patientId),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .limit(1);
      if (!patient || (input.clientId && input.clientId !== patient.clientId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
      }

      const [doctor] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.doctorId),
            eq(users.practiceId, ctx.practiceId),
            eq(users.isVeterinarian, true),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (!doctor) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Doctor not found" });
      }

      const [overlap] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.practiceId, ctx.practiceId),
            eq(appointments.doctorId, input.doctorId),
            isNull(appointments.deletedAt),
            notInArray(appointments.status, ["cancelled", "no_show"]),
            lt(appointments.startTime, end),
            gt(appointments.endTime, start),
          ),
        )
        .limit(1);
      if (overlap) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This time conflicts with another appointment for this doctor.",
        });
      }

      const [appointment] = await tx
        .insert(appointments)
        .values({
          practiceId: ctx.practiceId,
          patientId: patient.id,
          clientId: patient.clientId,
          doctorId: doctor.id,
          startTime: start,
          endTime: end,
          notes: input.notes,
        })
        .returning();
      if (!appointment) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Appointment could not be created",
        });
      }
      return appointment;
    });
  }),

  updateStatus: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician", "front_desk"))
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(appointmentStatusValues),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.status === "checked_out") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Review and complete the visit closeout before checking out this appointment.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${ctx.practiceId}))`,
        );
        const [current] = await tx
          .select({
            id: appointments.id,
            status: appointments.status,
            patientId: appointments.patientId,
            clientId: appointments.clientId,
            activePatientId: patients.id,
            activeClientId: clients.id,
          })
          .from(appointments)
          .leftJoin(
            patients,
            and(
              eq(patients.id, appointments.patientId),
              eq(patients.clientId, appointments.clientId),
              eq(patients.practiceId, ctx.practiceId),
              eq(patients.status, "active"),
              isNull(patients.deletedAt),
            ),
          )
          .leftJoin(
            clients,
            and(
              eq(clients.id, appointments.clientId),
              eq(clients.practiceId, ctx.practiceId),
              isNull(clients.deletedAt),
            ),
          )
          .where(
            and(
              eq(appointments.id, input.id),
              eq(appointments.practiceId, ctx.practiceId),
              isNull(appointments.deletedAt),
            ),
          )
          .limit(1);
        if (!current) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Appointment not found",
          });
        }

        const allowed: Record<string, readonly string[]> = {
          scheduled: ["checked_in"],
          confirmed: ["checked_in"],
          checked_in: ["in_exam"],
        };
        if (!allowed[current.status]?.includes(input.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot change appointment status from ${current.status} to ${input.status}.`,
          });
        }
        if (
          input.status === "in_exam" &&
          (!current.patientId ||
            !current.clientId ||
            current.activePatientId !== current.patientId ||
            current.activeClientId !== current.clientId)
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Attach an active patient and matching client before starting the exam.",
          });
        }

        const [updated] = await tx
          .update(appointments)
          .set({ status: input.status })
          .where(
            and(
              eq(appointments.id, input.id),
              eq(appointments.practiceId, ctx.practiceId),
              eq(appointments.status, current.status),
              isNull(appointments.deletedAt),
            ),
          )
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Appointment changed. Refresh and try again.",
          });
        }
        return updated;
      });
    }),

  delete: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician", "front_desk"))
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${ctx.practiceId}))`,
        );
        const [current] = await tx
          .select({ id: appointments.id, status: appointments.status })
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.id),
              eq(appointments.practiceId, ctx.practiceId),
              isNull(appointments.deletedAt),
            ),
          )
          .limit(1);
        if (!current) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Appointment not found",
          });
        }
        if (
          !["scheduled", "confirmed", "cancelled", "no_show"].includes(
            current.status,
          )
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Visits that have started must be corrected through the encounter workspace.",
          });
        }

        const now = new Date();
        const [deleted] = await tx
          .update(appointments)
          .set({ status: "cancelled", deletedAt: now })
          .where(
            and(
              eq(appointments.id, input.id),
              eq(appointments.practiceId, ctx.practiceId),
              isNull(appointments.deletedAt),
            ),
          )
          .returning({ id: appointments.id });
        if (!deleted) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Appointment not found",
          });
        }
        return { id: deleted.id };
      });
    }),
});
