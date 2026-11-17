import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  clients,
  invoiceItems,
  invoices,
  patients,
  practices,
  services,
} from "@openpims/db";
import type { Database } from "@openpims/db/client";
import {
  centsToMoney,
  invoiceBalanceCents,
  moneyToCents,
} from "@/lib/billing/invoice-balance";
import {
  BILLING_CURRENCY_AMOUNT_PATTERN,
  BILLING_INVOICE_LINE_DESCRIPTION_MAX_LENGTH,
  BILLING_INVOICE_LINE_QUANTITY_MAX,
  BILLING_INVOICE_LINE_QUANTITY_MIN,
  BILLING_INVOICE_MAX_ITEMS,
  BILLING_MAX_MONEY_CENTS,
} from "@/lib/billing/policy";
import { isSupportedQuantity, quantityLineTotalCents } from "@/lib/quantity";
import { createRouter, protectedProcedure, requireRole } from "../trpc";
import { listOffsetInput } from "./pagination";

const currencyAmountSchema = z
  .string()
  .trim()
  .refine(
    (value) => BILLING_CURRENCY_AMOUNT_PATTERN.test(value),
    "Amount must be a valid currency amount.",
  );

const invoiceLineInput = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Line item description is required.")
      .max(
        BILLING_INVOICE_LINE_DESCRIPTION_MAX_LENGTH,
        `Line item description must be at most ${BILLING_INVOICE_LINE_DESCRIPTION_MAX_LENGTH} characters.`,
      ),
    quantity: z
      .number()
      .min(BILLING_INVOICE_LINE_QUANTITY_MIN)
      .max(BILLING_INVOICE_LINE_QUANTITY_MAX)
      .refine(
        isSupportedQuantity,
        "Use at most three decimal places for quantity",
      ),
    unitPrice: currencyAmountSchema,
    itemType: z.enum(["service", "product"]),
    itemId: z.string().guid().optional(),
  })
  .superRefine((item, ctx) => {
    const totalCents = quantityLineTotalCents(
      moneyToCents(item.unitPrice),
      item.quantity,
    );
    if (totalCents > BILLING_MAX_MONEY_CENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["unitPrice"],
        message: "Line item total must fit a currency amount.",
      });
    }
  });

const createInvoiceInput = z
  .object({
    clientId: z.string().guid(),
    patientId: z.string().guid().optional(),
    appointmentId: z.string().guid().optional(),
    items: z
      .array(invoiceLineInput)
      .max(
        BILLING_INVOICE_MAX_ITEMS,
        `Invoices can include at most ${BILLING_INVOICE_MAX_ITEMS} items.`,
      ),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be a valid YYYY-MM-DD date.")
      .optional(),
    isEstimate: z.boolean().optional().default(false),
  })
  .superRefine((input, ctx) => {
    const subtotalCents = input.items.reduce(
      (sum, item) =>
        sum + quantityLineTotalCents(moneyToCents(item.unitPrice), item.quantity),
      0,
    );
    if (subtotalCents > BILLING_MAX_MONEY_CENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Invoice subtotal must fit a currency amount.",
      });
    }
  });

type BillingContext = {
  db: Database;
  practiceId: string;
};

function activePracticeWhere(practiceId: string) {
  return and(eq(practices.id, practiceId), isNull(practices.deletedAt));
}

async function assertClientBelongsToPractice(
  ctx: BillingContext,
  clientId: string,
) {
  const [client] = await ctx.db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, clientId),
        eq(clients.practiceId, ctx.practiceId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (!client) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

async function assertPatientBelongsToClient(
  ctx: BillingContext,
  patientId: string,
  clientId: string,
) {
  const [patient] = await ctx.db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.clientId, clientId),
        eq(patients.practiceId, ctx.practiceId),
        isNull(patients.deletedAt),
      ),
    )
    .limit(1);
  if (!patient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
  }
}

async function lockAppointmentForVisitBilling(
  ctx: BillingContext,
  appointmentId: string,
  clientId: string,
  patientId: string | undefined,
  isEstimate: boolean,
) {
  const conditions = [
    eq(appointments.id, appointmentId),
    eq(appointments.practiceId, ctx.practiceId),
    eq(appointments.clientId, clientId),
    isNull(appointments.deletedAt),
  ];
  if (patientId) conditions.push(eq(appointments.patientId, patientId));
  const [appointment] = await ctx.db
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(and(...conditions))
    .limit(1)
    .for("update");
  if (!appointment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Appointment not found for this client and patient.",
    });
  }
  if (!isEstimate && appointment.status !== "in_exam") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Start the exam before capturing visit charges.",
    });
  }
  if (
    isEstimate &&
    (appointment.status === "checked_out" ||
      appointment.status === "cancelled" ||
      appointment.status === "no_show")
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A terminal appointment cannot receive a new estimate.",
    });
  }
  return appointment;
}

async function serviceTaxability(
  ctx: BillingContext,
  items: Array<{ itemType: "service" | "product"; itemId?: string }>,
) {
  const serviceIds = [
    ...new Set(
      items
        .filter((item) => item.itemType === "service" && item.itemId)
        .map((item) => item.itemId as string),
    ),
  ].sort();
  const productIds = items.filter((item) => item.itemType === "product");
  if (productIds.length > 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or more products were not found",
    });
  }
  if (serviceIds.length === 0) return new Map<string, boolean>();
  const rows = await ctx.db
    .select({
      id: services.id,
      deletedAt: services.deletedAt,
      taxable: services.taxable,
    })
    .from(services)
    .where(
      and(inArray(services.id, serviceIds), eq(services.practiceId, ctx.practiceId)),
    )
    .orderBy(asc(services.id))
    .for("share");
  if (
    rows.length !== serviceIds.length ||
    rows.some((row) => row.deletedAt != null)
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One or more services were not found",
    });
  }
  return new Map(rows.map((row) => [row.id, row.taxable]));
}

const billingWriter = protectedProcedure.use(
  requireRole("admin", "front_desk"),
);

export const billingRouter = createRouter({
  listServices: protectedProcedure.query(async ({ ctx }) => {
    const [practice] = await ctx.db
      .select({ id: practices.id })
      .from(practices)
      .where(activePracticeWhere(ctx.practiceId))
      .limit(1);
    if (!practice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Practice not found" });
    }
    return ctx.db
      .select()
      .from(services)
      .where(
        and(eq(services.practiceId, ctx.practiceId), isNull(services.deletedAt)),
      )
      .orderBy(asc(services.name));
  }),

  listInvoices: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "sent", "paid", "overdue", "void"]).optional(),
        isEstimate: z.boolean().optional(),
        patientId: z.string().guid().optional(),
        appointmentId: z.string().guid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: listOffsetInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(invoices.practiceId, ctx.practiceId),
        isNull(invoices.deletedAt),
      ];
      if (input.status) conditions.push(eq(invoices.status, input.status));
      if (input.patientId) conditions.push(eq(invoices.patientId, input.patientId));
      if (input.appointmentId) {
        conditions.push(eq(invoices.appointmentId, input.appointmentId));
      }
      if (input.isEstimate !== undefined) {
        conditions.push(eq(invoices.isEstimate, input.isEstimate));
      }

      const [items, countResult] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            status: invoices.status,
            subtotal: invoices.subtotal,
            tax: invoices.tax,
            total: invoices.total,
            paidAmount: invoices.paidAmount,
            dueDate: invoices.dueDate,
            createdAt: invoices.createdAt,
            updatedAt: invoices.updatedAt,
            isEstimate: invoices.isEstimate,
            clientFirstName: clients.firstName,
            clientLastName: clients.lastName,
            patientName: patients.name,
            appointmentId: invoices.appointmentId,
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
              eq(patients.clientId, invoices.clientId),
              eq(patients.practiceId, ctx.practiceId),
              isNull(patients.deletedAt),
            ),
          )
          .where(and(...conditions))
          .orderBy(desc(invoices.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(invoices)
          .where(and(...conditions)),
      ]);

      return {
        items: items.map((item) => ({ ...item, adjustedAmount: "0.00" })),
        total: Number(countResult[0]?.count ?? 0),
      };
    }),

  getInvoice: protectedProcedure
    .input(z.object({ id: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({
          id: invoices.id,
          status: invoices.status,
          isEstimate: invoices.isEstimate,
          subtotal: invoices.subtotal,
          tax: invoices.tax,
          total: invoices.total,
          paidAmount: invoices.paidAmount,
          appointmentId: invoices.appointmentId,
          dueDate: invoices.dueDate,
          createdAt: invoices.createdAt,
          updatedAt: invoices.updatedAt,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          clientEmail: clients.email,
          patientName: patients.name,
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
            eq(patients.clientId, invoices.clientId),
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
        .select()
        .from(invoiceItems)
        .where(
          and(eq(invoiceItems.invoiceId, input.id), isNull(invoiceItems.deletedAt)),
        );
      return {
        ...invoice,
        items,
        adjustedAmount: "0.00",
        balanceDue: centsToMoney(invoiceBalanceCents(invoice)),
      };
    }),

  createInvoice: billingWriter
    .input(createInvoiceInput)
    .mutation(async ({ ctx, input }) => {
      await assertClientBelongsToPractice(ctx, input.clientId);
      if (input.patientId) {
        await assertPatientBelongsToClient(ctx, input.patientId, input.clientId);
      }
      const isEstimate = input.isEstimate ?? false;
      return ctx.db.transaction(async (tx) => {
        const txCtx: BillingContext = {
          db: tx as unknown as Database,
          practiceId: ctx.practiceId,
        };
        if (input.appointmentId) {
          await lockAppointmentForVisitBilling(
            txCtx,
            input.appointmentId,
            input.clientId,
            input.patientId,
            isEstimate,
          );
          const [existingVisitInvoice] = await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.practiceId, ctx.practiceId),
                eq(invoices.appointmentId, input.appointmentId),
                eq(invoices.isEstimate, isEstimate),
                ne(invoices.status, "void"),
                isNull(invoices.deletedAt),
              ),
            )
            .limit(1);
          if (existingVisitInvoice) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This visit already has an active invoice. Open it instead of creating a duplicate.",
            });
          }
        }
        const taxableByService = await serviceTaxability(txCtx, input.items);
        let subtotalCents = 0;
        const lines = input.items.map((item) => {
          const totalCents = quantityLineTotalCents(
            moneyToCents(item.unitPrice),
            item.quantity,
          );
          subtotalCents += totalCents;
          return {
            description: item.description,
            quantity: item.quantity,
            unitPrice: centsToMoney(moneyToCents(item.unitPrice)),
            total: centsToMoney(totalCents),
            taxable: item.itemId
              ? (taxableByService.get(item.itemId) ?? true)
              : true,
            itemType: item.itemType,
            itemId: item.itemId ?? null,
          };
        });
        const [invoice] = await tx
          .insert(invoices)
          .values({
            practiceId: ctx.practiceId,
            clientId: input.clientId,
            patientId: input.patientId ?? null,
            appointmentId: input.appointmentId ?? null,
            status: "draft",
            subtotal: centsToMoney(subtotalCents),
            tax: "0.00",
            total: centsToMoney(subtotalCents),
            paidAmount: "0.00",
            dueDate: input.dueDate ?? null,
            isEstimate,
          })
          .returning();
        if (!invoice) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Invoice could not be created",
          });
        }
        if (lines.length > 0) {
          await tx.insert(invoiceItems).values(
            lines.map((line) => ({ ...line, invoiceId: invoice.id })),
          );
        }
        return invoice;
      });
    }),
});
