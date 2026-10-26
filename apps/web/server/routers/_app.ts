import { createRouter } from "../trpc";
import { apiKeysRouter } from "./api-keys";
import { appointmentsRouter } from "./appointments";
import { authRouter } from "./auth";
import { clientsRouter } from "./clients";
import { communicationsRouter } from "./communications";
import { patientsRouter } from "./patients";
import { billingRouter } from "./billing";
import { inventoryRouter } from "./inventory";
import { recordsRouter } from "./records";
import { portalRouter } from "./portal";
import { subscriptionRouter } from "./subscription";
import { webhooksRouter } from "./webhooks";
import { whiteboardRouter } from "./whiteboard";

export const appRouter = createRouter({
  auth: authRouter,
  apiKeys: apiKeysRouter,
  clients: clientsRouter,
  communications: communicationsRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
  records: recordsRouter,
  billing: billingRouter,
  inventory: inventoryRouter,
  whiteboard: whiteboardRouter,
  subscription: subscriptionRouter,
  webhooks: webhooksRouter,
  portal: portalRouter,
});

export type AppRouter = typeof appRouter;
