import type { clients } from "@openpims/db";
import type { ApiClient } from "./schema";

type ClientRow = typeof clients.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

export function toApiClient(row: ClientRow): ApiClient {
  return {
    id: row.id,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    preferred_contact_method: row.preferredContactMethod,
    notes: row.notes,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}
