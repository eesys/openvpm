import { z } from "zod";

/**
 * Public client shape for GET /api/v1/clients. Internal columns such as the
 * portal access token stay out of this contract.
 */
export const ApiClientSchema = z.object({
  id: z.string().guid(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  preferred_contact_method: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ApiClient = z.infer<typeof ApiClientSchema>;
