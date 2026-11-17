import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { clientsRouter } from "./clients";
import { patientsRouter } from "./patients";
import { recordsRouter } from "./records";

export const appRouter = createRouter({
  auth: authRouter,
  appointments: appointmentsRouter,
  billing: billingRouter,
  clients: clientsRouter,
  patients: patientsRouter,
  records: recordsRouter,
});

export type AppRouter = typeof appRouter;
