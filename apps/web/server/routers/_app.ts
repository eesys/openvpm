import { createRouter } from "../trpc";
import { authRouter } from "./auth";

export const appRouter = createRouter({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
