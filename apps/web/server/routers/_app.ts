import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { clientsRouter } from "./clients";
import { patientsRouter } from "./patients";
import { billingRouter } from "./billing";
import { recordsRouter } from "./records";

export const appRouter = createRouter({
  auth: authRouter,
  clients: clientsRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
  records: recordsRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;
