import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { clientsRouter } from "./clients";
import { patientsRouter } from "./patients";
import { billingRouter } from "./billing";
import { inventoryRouter } from "./inventory";
import { recordsRouter } from "./records";
import { whiteboardRouter } from "./whiteboard";

export const appRouter = createRouter({
  auth: authRouter,
  clients: clientsRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
  records: recordsRouter,
  billing: billingRouter,
  inventory: inventoryRouter,
  whiteboard: whiteboardRouter,
});

export type AppRouter = typeof appRouter;
