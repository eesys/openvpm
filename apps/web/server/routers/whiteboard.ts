import { TRPCError } from "@trpc/server";
import { and, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appointmentTypes,
  appointments,
  clients,
  patients,
  practices,
  users,
} from "@openpims/db";
import type { Database } from "@openpims/db/client";
import { dateInputUtcRangeForTimeZone } from "@/lib/date-input";
import { CLOSEOUT_BYPASS_MESSAGE } from "@/lib/encounters/closeout-policy";
import {
  appointmentStatusValues,
  canTransitionAppointmentStatus,
} from "@/lib/scheduling/appointment-status";
import { conflictMessage, detectConflicts } from "@/lib/scheduling/conflicts";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

type WhiteboardContext = {
  db: Database;
  practiceId: string;
};

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1
    from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

async function practiceSettings(ctx: WhiteboardContext) {
  const [practice] = await ctx.db
    .select({
      name: practices.name,
      phone: practices.phone,
      timezone: practices.timezone,
    })
    .from(practices)
    .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
    .limit(1);
  if (!practice) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  }
  return {
    name: practice.name.trim() || "Veterinary Practice",
    phone: practice.phone ?? null,
    timezone: practice.timezone ?? null,
  };
}

export const whiteboardRouter = createRouter({
  settings: protectedProcedure.query(async ({ ctx }) => practiceSettings(ctx)),

  getActive: protectedProcedure.query(async ({ ctx }) => {
    const today = dateInputUtcRangeForTimeZone(
      new Date(),
      (await practiceSettings(ctx)).timezone,
    );
    return ctx.db
      .select({
        id: appointments.id,
        status: appointments.status,
        startTime: appointments.startTime,
        notes: appointments.notes,
        patientId: patients.id,
        clientId: clients.id,
        patientName: patients.name,
        patientSpecies: patients.species,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        doctorName: users.name,
        typeName: appointmentTypes.name,
      })
      .from(appointments)
      .leftJoin(
        patients,
        and(
          eq(appointments.patientId, patients.id),
          eq(patients.clientId, appointments.clientId),
          eq(patients.practiceId, ctx.practiceId),
          eq(patients.status, "active"),
          activePracticePredicate(ctx.practiceId),
          isNull(patients.deletedAt),
        ),
      )
      .leftJoin(
        clients,
        and(
          eq(appointments.clientId, clients.id),
          eq(clients.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(clients.deletedAt),
        ),
      )
      .leftJoin(
        users,
        and(
          eq(appointments.doctorId, users.id),
          eq(users.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(users.deletedAt),
        ),
      )
      .leftJoin(
        appointmentTypes,
        and(
          eq(appointments.typeId, appointmentTypes.id),
          eq(appointmentTypes.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(appointmentTypes.deletedAt),
        ),
      )
      .where(
        and(
          eq(appointments.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(appointments.deletedAt),
          gte(appointments.startTime, today.start),
          lt(appointments.startTime, today.end),
          inArray(appointments.status, [
            "confirmed",
            "checked_in",
            "in_exam",
            "checked_out",
          ]),
        ),
      )
      .orderBy(appointments.startTime);
  }),

  updateStatus: protectedProcedure
    .use(requireRole("admin", "veterinarian", "technician", "front_desk"))
    .input(
      z.object({
        id: z.string().guid(),
        status: z.enum(appointmentStatusValues),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: appointments.id,
            status: appointments.status,
            doctorId: appointments.doctorId,
            patientId: appointments.patientId,
            clientId: appointments.clientId,
            activePatientId: patients.id,
            activeClientId: clients.id,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            typeRequiresDoctor: appointmentTypes.requiresDoctor,
          })
          .from(appointments)
          .leftJoin(
            appointmentTypes,
            and(
              eq(appointments.typeId, appointmentTypes.id),
              eq(appointmentTypes.practiceId, ctx.practiceId),
              isNull(appointmentTypes.deletedAt),
            ),
          )
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
          .where(
            and(
              eq(appointments.id, input.id),
              eq(appointments.practiceId, ctx.practiceId),
              activePracticePredicate(ctx.practiceId),
              isNull(appointments.deletedAt),
            ),
          )
          .for("update", { of: appointments });

        if (!current) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Appointment not found",
          });
        }
        if (input.status === "checked_out") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: CLOSEOUT_BYPASS_MESSAGE,
          });
        }
        if (!canTransitionAppointmentStatus(current.status, input.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot change appointment status from ${current.status} to ${input.status}.`,
          });
        }
        if (
          (input.status === "confirmed" || input.status === "checked_in") &&
          current.typeRequiresDoctor === 1 &&
          !current.doctorId
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              input.status === "confirmed"
                ? "Assign a doctor before confirming this appointment."
                : "Assign a doctor before checking in this appointment.",
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
        if (
          (current.status === "cancelled" || current.status === "no_show") &&
          input.status === "scheduled"
        ) {
          const existing = await tx
            .select({
              id: appointments.id,
              startTime: appointments.startTime,
              endTime: appointments.endTime,
              doctorId: appointments.doctorId,
              status: appointments.status,
            })
            .from(appointments)
            .where(
              and(
                eq(appointments.practiceId, ctx.practiceId),
                activePracticePredicate(ctx.practiceId),
                isNull(appointments.deletedAt),
                lt(appointments.startTime, current.endTime),
                gt(appointments.endTime, current.startTime),
              ),
            );
          const message = conflictMessage(
            detectConflicts(
              {
                startTime: current.startTime,
                endTime: current.endTime,
                doctorId: current.doctorId,
                excludeId: current.id,
              },
              existing.map((booking) => ({ ...booking, roomId: null })),
            ),
          );
          if (message) throw new TRPCError({ code: "CONFLICT", message });
        }

        const [updated] = await tx
          .update(appointments)
          .set({ status: input.status })
          .where(
            and(
              eq(appointments.id, current.id),
              eq(appointments.practiceId, ctx.practiceId),
              eq(appointments.status, current.status),
              isNull(appointments.deletedAt),
            ),
          )
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Appointment status changed; try again.",
          });
        }
        return updated;
      });
    }),
});
