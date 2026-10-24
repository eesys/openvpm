import type { clients } from "@openpims/db";

type ClientRow = typeof clients.$inferSelect;

export function toApiClient(row: ClientRow) {
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
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
