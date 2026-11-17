import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { patients, practices } from "@openpims/db";
import { PORTAL_ACCESS_TOKEN_MAX_LENGTH } from "@/lib/portal/tokens";
import { createRouter, portalProcedure } from "../trpc";

const portalTokenCompatibilityInput = z
  .string()
  .trim()
  .min(1)
  .max(PORTAL_ACCESS_TOKEN_MAX_LENGTH)
  .optional();

export const portalRouter = createRouter({
  getClient: portalProcedure
    .input(z.object({ token: portalTokenCompatibilityInput }))
    .query(async ({ ctx }) => {
      const client = ctx.portalClient;
      const [practice, clientPatients] = await Promise.all([
        ctx.db
          .select({
            name: practices.name,
            phone: practices.phone,
            timezone: practices.timezone,
          })
          .from(practices)
          .where(
            and(eq(practices.id, client.practiceId), isNull(practices.deletedAt)),
          )
          .limit(1),
        ctx.db
          .select({
            id: patients.id,
            name: patients.name,
            species: patients.species,
            breed: patients.breed,
          })
          .from(patients)
          .where(
            and(
              eq(patients.clientId, client.id),
              eq(patients.practiceId, client.practiceId),
              eq(patients.status, "active"),
              isNull(patients.deletedAt),
            ),
          ),
      ]);
      const clinic = practice[0];
      if (!clinic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid portal link" });
      }
      return {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
        practice: clinic,
        patients: clientPatients,
      };
    }),
});
