import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { clientsRouter } from "./clients";
import { patientsRouter } from "./patients";

export const appRouter = createRouter({
  auth: authRouter,
  clients: clientsRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
});

export type AppRouter = typeof appRouter;
