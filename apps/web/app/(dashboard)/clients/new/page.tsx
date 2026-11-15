"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import {
  CLIENT_ADDRESS_MAX_LENGTH,
  CLIENT_CITY_MAX_LENGTH,
  CLIENT_CONTACT_METHODS,
  CLIENT_EMAIL_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_PHONE_MAX_LENGTH,
  CLIENT_STATE_MAX_LENGTH,
  CLIENT_ZIP_MAX_LENGTH,
  type ClientContactMethod,
  isOptionalClientTextValid,
  isRequiredClientTextValid,
} from "@/lib/clients/policy";

const contactMethodLabels: Record<ClientContactMethod, string> = {
  phone: "Phone call",
  email: "Email",
  sms: "Text message",
  portal: "Client portal",
};

function canManageClientFormRole(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "veterinarian" ||
    role === "technician" ||
    role === "front_desk"
  );
}

export default function NewClientPage() {
  return (
    <Suspense fallback={<p>Checking client access...</p>}>
      <NewClientPageContent />
    </Suspense>
  );
}

function NewClientPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const firstClinicDay = searchParams.get("setup") === "first-visit";

  if (status === "loading") {
    return <p>Checking client access...</p>;
  }

  if (!canManageClientFormRole(session?.user?.role)) {
    return (
      <main>
        <p>
          <a href="/clients">Back to Clients</a>
        </p>
        <h1>Client actions are read-only</h1>
        <p>Only staff roles with client write access can create clients.</p>
      </main>
    );
  }

  return <NewClientForm firstClinicDay={firstClinicDay} />;
}

function NewClientForm({ firstClinicDay }: { firstClinicDay: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });
  const [preferredContactMethod, setPreferredContactMethod] =
    useState<ClientContactMethod>("phone");
  const [error, setError] = useState<string | null>(null);

  const createClient = trpc.clients.create.useMutation({
    onSuccess: async (client) => {
      await utils.clients.list.invalidate();
      if (firstClinicDay) {
        const ownerName = `${client.firstName} ${client.lastName}`;
        router.push(
          `/patients/new?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(ownerName)}&setup=first-visit`,
        );
        return;
      }
      router.push(`/clients/${client.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit =
    isRequiredClientTextValid(form.firstName, CLIENT_NAME_MAX_LENGTH) &&
    isRequiredClientTextValid(form.lastName, CLIENT_NAME_MAX_LENGTH) &&
    isOptionalClientTextValid(form.email, CLIENT_EMAIL_MAX_LENGTH) &&
    isOptionalClientTextValid(form.phone, CLIENT_PHONE_MAX_LENGTH) &&
    isOptionalClientTextValid(form.address, CLIENT_ADDRESS_MAX_LENGTH) &&
    isOptionalClientTextValid(form.city, CLIENT_CITY_MAX_LENGTH) &&
    isOptionalClientTextValid(form.state, CLIENT_STATE_MAX_LENGTH) &&
    isOptionalClientTextValid(form.zip, CLIENT_ZIP_MAX_LENGTH);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError("Check required fields and field lengths.");
      return;
    }

    createClient.mutate({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      zip: form.zip.trim() || undefined,
      preferredContactMethod,
    });
  };

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <main>
      <p>
        <a href="/clients">Back to Clients</a>
      </p>
      <h1>New Client</h1>
      <p>
        {firstClinicDay
          ? "First clinic day, step 1 of 3: add one real owner. Their pet is next."
          : "Add a new client to your practice"}
      </p>
      {error ? <p>{error}</p> : null}
      <form onSubmit={handleSubmit}>
        <label>
          First Name
          <input
            value={form.firstName}
            onChange={(event) => updateField("firstName", event.target.value)}
            maxLength={CLIENT_NAME_MAX_LENGTH}
            required
          />
        </label>
        <label>
          Last Name
          <input
            value={form.lastName}
            onChange={(event) => updateField("lastName", event.target.value)}
            maxLength={CLIENT_NAME_MAX_LENGTH}
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            maxLength={CLIENT_EMAIL_MAX_LENGTH}
          />
        </label>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            maxLength={CLIENT_PHONE_MAX_LENGTH}
          />
        </label>
        <label>
          Address
          <input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            maxLength={CLIENT_ADDRESS_MAX_LENGTH}
          />
        </label>
        <label>
          City
          <input
            value={form.city}
            onChange={(event) => updateField("city", event.target.value)}
            maxLength={CLIENT_CITY_MAX_LENGTH}
          />
        </label>
        <label>
          State
          <input
            value={form.state}
            onChange={(event) => updateField("state", event.target.value)}
            maxLength={CLIENT_STATE_MAX_LENGTH}
          />
        </label>
        <label>
          ZIP
          <input
            value={form.zip}
            onChange={(event) => updateField("zip", event.target.value)}
            maxLength={CLIENT_ZIP_MAX_LENGTH}
          />
        </label>
        <label>
          Preferred contact for reminders
          <select
            value={preferredContactMethod}
            onChange={(event) => {
              const value = event.target.value;
              if (
                (CLIENT_CONTACT_METHODS as readonly string[]).includes(value)
              ) {
                setPreferredContactMethod(value as ClientContactMethod);
              }
            }}
          >
            {CLIENT_CONTACT_METHODS.map((method) => (
              <option key={method} value={method}>
                {contactMethodLabels[method]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!canSubmit || createClient.isPending}>
          {createClient.isPending ? "Creating..." : "Create Client"}
        </button>
        <button type="button" onClick={() => router.push("/clients")}>
          Cancel
        </button>
      </form>
    </main>
  );
}
