import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { appointmentStatusValues, appointments, clients, patients, practices, users } from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const boardStatuses = ["confirmed", "checked_in", "in_exam", "checked_out"] as const;

const staffMove = protectedProcedure.use(
  requireRole("admin", "veterinarian", "technician", "front_desk"),
);

function calendarDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addCalendarDay(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function midnightInTimeZone(ymd: string, timeZone: string) {
  const utcGuess = new Date(`${ymd}T00:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcGuess);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const hour = value("hour") === "24" ? "0" : value("hour");
  const zonedAsUtc = Date.UTC(
    Number(value("year")),
    Number(value("month")) - 1,
    Number(value("day")),
    Number(hour),
    Number(value("minute")),
    Number(value("second")),
  );
  return new Date(utcGuess.getTime() - (zonedAsUtc - utcGuess.getTime()));
}

export const whiteboardRouter = createRouter({
  getActive: protectedProcedure.query(async ({ ctx }) => {
    const [practice] = await ctx.db
      .select({ timezone: practices.timezone })
      .from(practices)
      .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
      .limit(1);
    if (!practice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
    }
    const today = calendarDate(new Date(), practice.timezone);
    const start = midnightInTimeZone(today, practice.timezone);
    const end = midnightInTimeZone(addCalendarDay(today), practice.timezone);

    return ctx.db
      .select({
        id: appointments.id,
        status: appointments.status,
        startTime: appointments.startTime,
        notes: appointments.notes,
        patientId: patients.id,
        patientName: patients.name,
        patientSpecies: patients.species,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        doctorName: users.name,
      })
      .from(appointments)
      .leftJoin(
        patients,
        and(
          eq(appointments.patientId, patients.id),
          eq(patients.clientId, appointments.clientId),
          eq(patients.practiceId, ctx.practiceId),
          eq(patients.status, "active"),
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
          isNull(users.deletedAt),
        ),
      )
      .where(
        and(
          eq(appointments.practiceId, ctx.practiceId),
          isNull(appointments.deletedAt),
          gte(appointments.startTime, start),
          lt(appointments.startTime, end),
          inArray(appointments.status, [...boardStatuses]),
        ),
      )
      .orderBy(appointments.startTime);
  }),

  updateStatus: staffMove
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
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.practiceId}))`);
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
              eq(appointments.patientId, patients.id),
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
          throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
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
            message: "Attach an active patient and matching client before starting the exam.",
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
});
