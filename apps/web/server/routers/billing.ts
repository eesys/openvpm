import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  appointments,
  clients,
  invoiceItemTypeValues,
  invoiceItems,
  invoices,
  patients,
} from "@openpims/db";
import { z } from "zod";
import { createRouter, protectedProcedure, requireRole } from "../trpc";

const staffBill = protectedProcedure.use(requireRole("admin", "front_desk"));

const moneyInput = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/);

const lineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z
    .number()
    .min(0.001)
    .max(10000)
    .refine(
      (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6,
      "Use at most three decimal places for quantity",
    ),
  unitPrice: moneyInput,
  itemType: z.enum(invoiceItemTypeValues),
});

const createInput = z.object({
  appointmentId: z.string().uuid(),
  clientId: z.string().uuid(),
  patientId: z.string().uuid(),
  items: z.array(lineInput).length(1),
});

function moneyToCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function centsToMoney(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function lineTotalCents(unitPrice: string, quantity: number) {
  const milli = Math.round(quantity * 1000);
  return Math.round((moneyToCents(unitPrice) * milli) / 1000);
}

export const billingRouter = createRouter({
  listInvoices: protectedProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(invoices.practiceId, ctx.practiceId),
        isNull(invoices.deletedAt),
      ];
      if (input.appointmentId) {
        conditions.push(eq(invoices.appointmentId, input.appointmentId));
      }
      const where = and(...conditions);
      const [items, countResult] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            status: invoices.status,
            subtotal: invoices.subtotal,
            tax: invoices.tax,
            total: invoices.total,
            paidAmount: invoices.paidAmount,
            appointmentId: invoices.appointmentId,
            patientName: patients.name,
            clientFirstName: clients.firstName,
            clientLastName: clients.lastName,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .leftJoin(
            clients,
            and(
              eq(invoices.clientId, clients.id),
              eq(clients.practiceId, ctx.practiceId),
              isNull(clients.deletedAt),
            ),
          )
          .leftJoin(
            patients,
            and(
              eq(invoices.patientId, patients.id),
              eq(patients.practiceId, ctx.practiceId),
              isNull(patients.deletedAt),
            ),
          )
          .where(where)
          .orderBy(desc(invoices.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` }).from(invoices).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  getInvoice: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({
          id: invoices.id,
          status: invoices.status,
          subtotal: invoices.subtotal,
          tax: invoices.tax,
          total: invoices.total,
          paidAmount: invoices.paidAmount,
          appointmentId: invoices.appointmentId,
          clientId: invoices.clientId,
          patientId: invoices.patientId,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          patientName: patients.name,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .leftJoin(
          clients,
          and(
            eq(invoices.clientId, clients.id),
            eq(clients.practiceId, ctx.practiceId),
            isNull(clients.deletedAt),
          ),
        )
        .leftJoin(
          patients,
          and(
            eq(invoices.patientId, patients.id),
            eq(patients.practiceId, ctx.practiceId),
            isNull(patients.deletedAt),
          ),
        )
        .where(
          and(
            eq(invoices.id, input.id),
            eq(invoices.practiceId, ctx.practiceId),
            isNull(invoices.deletedAt),
          ),
        )
        .limit(1);
      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }
      const items = await ctx.db
        .select({
          id: invoiceItems.id,
          description: invoiceItems.description,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPrice,
          total: invoiceItems.total,
          itemType: invoiceItems.itemType,
        })
        .from(invoiceItems)
        .where(
          and(eq(invoiceItems.invoiceId, invoice.id), isNull(invoiceItems.deletedAt)),
        )
        .orderBy(invoiceItems.createdAt);
      return { ...invoice, items };
    }),

  createInvoice: staffBill.input(createInput).mutation(async ({ ctx, input }) => {
    const line = input.items[0];
    if (!line) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An invoice must include at least one line item.",
      });
    }
    const totalCents = lineTotalCents(line.unitPrice, line.quantity);
    const total = centsToMoney(totalCents);

    return ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.appointmentId}, 0))`,
      );
      const [appointment] = await tx
        .select({ id: appointments.id, status: appointments.status })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, input.appointmentId),
            eq(appointments.practiceId, ctx.practiceId),
            eq(appointments.clientId, input.clientId),
            eq(appointments.patientId, input.patientId),
            isNull(appointments.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!appointment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Appointment not found for this client and patient.",
        });
      }
      if (appointment.status !== "in_exam") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Start the exam before capturing visit charges.",
        });
      }

      const [existing] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.practiceId, ctx.practiceId),
            eq(invoices.appointmentId, input.appointmentId),
            eq(invoices.isEstimate, false),
            ne(invoices.status, "void"),
            isNull(invoices.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This visit already has an active invoice. Open it instead of creating a duplicate.",
        });
      }

      const [invoice] = await tx
        .insert(invoices)
        .values({
          practiceId: ctx.practiceId,
          clientId: input.clientId,
          patientId: input.patientId,
          appointmentId: input.appointmentId,
          status: "draft",
          subtotal: total,
          tax: "0.00",
          total,
          paidAmount: "0.00",
          isEstimate: false,
        })
        .returning();
      if (!invoice) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invoice could not be created",
        });
      }
      await tx.insert(invoiceItems).values({
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: centsToMoney(moneyToCents(line.unitPrice)),
        total,
        taxable: true,
        itemType: line.itemType,
      });
      return invoice;
    });
  }),
});
