import { createRouter } from "../trpc";
import { apiKeysRouter } from "./api-keys";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { clientsRouter } from "./clients";
import { communicationsRouter } from "./communications";
import { inventoryRouter } from "./inventory";
import { patientsRouter } from "./patients";
import { portalRouter } from "./portal";
import { recordsRouter } from "./records";
import { webhooksRouter } from "./webhooks";
import { whiteboardRouter } from "./whiteboard";

export const appRouter = createRouter({
  apiKeys: apiKeysRouter,
  auth: authRouter,
  appointments: appointmentsRouter,
  billing: billingRouter,
  clients: clientsRouter,
  communications: communicationsRouter,
  inventory: inventoryRouter,
  patients: patientsRouter,
  portal: portalRouter,
  records: recordsRouter,
  webhooks: webhooksRouter,
  whiteboard: whiteboardRouter,
});

export type AppRouter = typeof appRouter;
