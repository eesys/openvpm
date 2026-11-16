import { TRPCError } from "@trpc/server";
import { and, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
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
import {
  APPOINTMENT_DURATION_MAX_MINUTES,
  APPOINTMENT_DURATION_MIN_MINUTES,
  APPOINTMENT_NOTES_MAX_LENGTH,
  isAppointmentDateInputValid,
  isAppointmentDateTimeRangeValid,
} from "@/lib/scheduling/appointment-policy";
import { conflictMessage, detectConflicts } from "@/lib/scheduling/conflicts";
import { dateInputDayUtcRange } from "@/lib/date-input";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

type AppointmentsContext = {
  db: Database;
  practiceId: string;
};

const appointmentDateTimeInput = z.string().datetime({ offset: true });
const appointmentNotesInput = z
  .string()
  .trim()
  .max(
    APPOINTMENT_NOTES_MAX_LENGTH,
    `Appointment notes must be at most ${APPOINTMENT_NOTES_MAX_LENGTH} characters.`,
  )
  .optional()
  .transform((value) => value || undefined);
const appointmentRangeInput = z.string().refine(
  (value) =>
    isAppointmentDateInputValid(value) ||
    appointmentDateTimeInput.safeParse(value).success,
  "Date range values must be valid YYYY-MM-DD dates or ISO datetimes with offsets.",
);

const listAppointmentsInput = z
  .object({
    startDate: appointmentRangeInput,
    endDate: appointmentRangeInput,
    doctorId: z.string().guid().optional(),
  })
  .superRefine((input, ctx) => {
    if (
      appointmentRangeEnd(input.endDate) < appointmentRangeStart(input.startDate)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after start date.",
      });
    }
  });

const createAppointmentInput = z
  .object({
    startTime: appointmentDateTimeInput,
    endTime: appointmentDateTimeInput,
    typeId: z.string().guid().optional(),
    patientId: z.string().guid().optional(),
    clientId: z.string().guid().optional(),
    doctorId: z.string().guid().optional(),
    notes: appointmentNotesInput,
  })
  .superRefine((input, ctx) => {
    if (!isAppointmentDateTimeRangeValid(input.startTime, input.endTime)) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: `Appointment duration must be between ${APPOINTMENT_DURATION_MIN_MINUTES} and ${APPOINTMENT_DURATION_MAX_MINUTES} minutes.`,
      });
    }
  });

function appointmentRangeStart(value: string, timeZone?: string | null): Date {
  if (!isAppointmentDateInputValid(value)) return new Date(value);
  if (timeZone) return dateInputDayUtcRange(value, timeZone).start;
  return new Date(`${value}T00:00:00.000Z`);
}

function appointmentRangeEnd(value: string, timeZone?: string | null): Date {
  if (!isAppointmentDateInputValid(value)) return new Date(value);
  if (timeZone) {
    const { end } = dateInputDayUtcRange(value, timeZone);
    return new Date(end.getTime() - 1);
  }
  return new Date(`${value}T23:59:59.999Z`);
}

function activePracticePredicate(practiceId: string) {
  return sql`exists (
    select 1 from ${practices}
    where ${practices.id} = ${practiceId}
      and ${practices.deletedAt} is null
  )`;
}

async function practiceTimeZone(ctx: AppointmentsContext): Promise<string | null> {
  const [practice] = await ctx.db
    .select({ timezone: practices.timezone })
    .from(practices)
    .where(and(eq(practices.id, ctx.practiceId), isNull(practices.deletedAt)))
    .limit(1);
  if (!practice) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
  }
  return practice.timezone ?? null;
}

async function assertClientBelongsToPractice(
  ctx: AppointmentsContext,
  clientId: string,
) {
  const [client] = await ctx.db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, clientId),
        eq(clients.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (!client) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

async function assertPatientBelongsToPractice(
  ctx: AppointmentsContext,
  patientId: string,
) {
  const [patient] = await ctx.db
    .select({ id: patients.id, clientId: patients.clientId })
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(patients.deletedAt),
      ),
    )
    .limit(1);
  if (!patient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
  }
  return patient;
}

async function assertAppointmentTypeBelongsToPractice(
  ctx: AppointmentsContext,
  typeId: string,
) {
  const [type] = await ctx.db
    .select({ id: appointmentTypes.id })
    .from(appointmentTypes)
    .where(
      and(
        eq(appointmentTypes.id, typeId),
        eq(appointmentTypes.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(appointmentTypes.deletedAt),
      ),
    )
    .limit(1);
  if (!type) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Appointment type not found",
    });
  }
}

async function assertDoctorBelongsToPractice(
  ctx: AppointmentsContext,
  doctorId: string,
) {
  const [doctor] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, doctorId),
        eq(users.practiceId, ctx.practiceId),
        eq(users.isVeterinarian, true),
        activePracticePredicate(ctx.practiceId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!doctor) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Doctor not found" });
  }
}

async function appointmentTargets(
  ctx: AppointmentsContext,
  input: {
    patientId?: string;
    clientId?: string;
    typeId?: string;
    doctorId?: string;
  },
) {
  let patientClientId: string | undefined;
  if (input.patientId) {
    patientClientId = (await assertPatientBelongsToPractice(ctx, input.patientId))
      .clientId;
  }
  const clientId = input.clientId ?? patientClientId;
  if (input.clientId && patientClientId && input.clientId !== patientClientId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
  }
  if (clientId) await assertClientBelongsToPractice(ctx, clientId);
  if (input.typeId) {
    await assertAppointmentTypeBelongsToPractice(ctx, input.typeId);
  }
  if (input.doctorId) await assertDoctorBelongsToPractice(ctx, input.doctorId);
  return { clientId };
}

export const appointmentsRouter = createRouter({
  list: protectedProcedure
    .input(listAppointmentsInput)
    .query(async ({ ctx, input }) => {
      const timeZone =
        isAppointmentDateInputValid(input.startDate) ||
        isAppointmentDateInputValid(input.endDate)
          ? await practiceTimeZone(ctx)
          : null;
      const start = appointmentRangeStart(input.startDate, timeZone);
      const end = appointmentRangeEnd(input.endDate, timeZone);
      const conditions = [
        eq(appointments.practiceId, ctx.practiceId),
        activePracticePredicate(ctx.practiceId),
        isNull(appointments.deletedAt),
        gte(appointments.startTime, start),
        lte(appointments.startTime, end),
      ];
      if (input.doctorId) {
        conditions.push(eq(appointments.doctorId, input.doctorId));
      }

      return ctx.db
        .select({
          id: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          status: appointments.status,
          origin: appointments.origin,
          notes: appointments.notes,
          patientName: patients.name,
          patientSpecies: patients.species,
          patientId: appointments.patientId,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          clientId: appointments.clientId,
          doctorName: users.name,
          doctorId: appointments.doctorId,
          typeName: appointmentTypes.name,
          typeColor: appointmentTypes.color,
          typeDuration: appointmentTypes.durationMinutes,
        })
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
        .leftJoin(
          appointmentTypes,
          and(
            eq(appointments.typeId, appointmentTypes.id),
            eq(appointmentTypes.practiceId, ctx.practiceId),
            isNull(appointmentTypes.deletedAt),
          ),
        )
        .where(and(...conditions))
        .orderBy(appointments.startTime);
    }),

  calendarSettings: protectedProcedure.query(async ({ ctx }) => ({
    timezone: await practiceTimeZone(ctx),
  })),

  listTypes: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(appointmentTypes)
      .where(
        and(
          eq(appointmentTypes.practiceId, ctx.practiceId),
          activePracticePredicate(ctx.practiceId),
          isNull(appointmentTypes.deletedAt),
        ),
      );
  }),

  listDoctors: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: users.id,
        name: users.name,
      })
      .from(users)
      .where(
        and(
          eq(users.practiceId, ctx.practiceId),
          eq(users.isVeterinarian, true),
          activePracticePredicate(ctx.practiceId),
          isNull(users.deletedAt),
        ),
      );
  }),

  create: protectedProcedure
    .use(requireRole("admin", "veterinarian", "front_desk"))
    .input(createAppointmentInput)
    .mutation(async ({ ctx, input }) => {
      const startTime = new Date(input.startTime);
      const endTime = new Date(input.endTime);
      if (endTime <= startTime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time.",
        });
      }

      const targets = await appointmentTargets(ctx, input);
      const existing = await ctx.db
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
            lt(appointments.startTime, endTime),
            gt(appointments.endTime, startTime),
          ),
        );
      const message = conflictMessage(
        detectConflicts(
          {
            startTime,
            endTime,
            doctorId: input.doctorId,
          },
          existing.map((booking) => ({ ...booking, roomId: null })),
        ),
      );
      if (message) throw new TRPCError({ code: "CONFLICT", message });

      const [appointment] = await ctx.db
        .insert(appointments)
        .values({
          ...input,
          clientId: targets.clientId,
          startTime,
          endTime,
          practiceId: ctx.practiceId,
        })
        .returning();
      if (!appointment) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Appointment could not be created",
        });
      }
      return appointment;
    }),
});
