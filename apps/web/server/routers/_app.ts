import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { clientsRouter } from "./clients";
import { patientsRouter } from "./patients";
import { recordsRouter } from "./records";

export const appRouter = createRouter({
  auth: authRouter,
  appointments: appointmentsRouter,
  clients: clientsRouter,
  patients: patientsRouter,
  records: recordsRouter,
});

export type AppRouter = typeof appRouter;
