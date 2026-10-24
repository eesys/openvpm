import { and, eq, isNull } from "drizzle-orm";
import { patients } from "@openpims/db";
import { z } from "zod";
import { createRouter, portalProcedure } from "../trpc";

export const portalRouter = createRouter({
  getClient: portalProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
    const client = ctx.portalClient;
    const clientPatients = await ctx.db
      .select({
        id: patients.id,
        name: patients.name,
        species: patients.species,
        breed: patients.breed,
        status: patients.status,
      })
      .from(patients)
      .where(
        and(
          eq(patients.clientId, client.id),
          eq(patients.practiceId, client.practiceId),
          eq(patients.status, "active"),
          isNull(patients.deletedAt),
        ),
      );
    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      patients: clientPatients,
    };
  }),
});
