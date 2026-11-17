import { createRouter } from "../trpc";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { clientsRouter } from "./clients";
import { inventoryRouter } from "./inventory";
import { patientsRouter } from "./patients";
import { portalRouter } from "./portal";
import { recordsRouter } from "./records";
import { whiteboardRouter } from "./whiteboard";

export const appRouter = createRouter({
  auth: authRouter,
  appointments: appointmentsRouter,
  billing: billingRouter,
  clients: clientsRouter,
  inventory: inventoryRouter,
  patients: patientsRouter,
  portal: portalRouter,
  records: recordsRouter,
  whiteboard: whiteboardRouter,
});

export type AppRouter = typeof appRouter;
