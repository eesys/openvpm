"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import {
  CLIENT_SEARCH_MAX_LENGTH,
  isClientSearchInputValid,
} from "@/lib/clients/policy";
import {
  PATIENT_BREED_MAX_LENGTH,
  PATIENT_COLOR_MAX_LENGTH,
  PATIENT_MICROCHIP_NUMBER_MAX_LENGTH,
  PATIENT_NAME_MAX_LENGTH,
  isOptionalPatientTextValid,
  isRequiredPatientTextValid,
} from "@/lib/patients/policy";
import {
  PATIENT_SPECIES,
  PATIENT_SPECIES_OPTIONS,
  type PatientSpecies,
} from "@/lib/patients/species";

const sexOptions = [
  { value: "male", label: "Male (Intact)" },
  { value: "female", label: "Female (Intact)" },
  { value: "male_neutered", label: "Male (Neutered)" },
  { value: "female_spayed", label: "Female (Spayed)" },
] as const;

type PatientSex = (typeof sexOptions)[number]["value"];

export default function NewPatientPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <p>Checking patient access...</p>;
  }

  if (!canManagePatientFormRole(session?.user?.role)) {
    return (
      <main>
        <p>
          <a href="/patients">Back to Patients</a>
        </p>
        <h1>Patient actions are read-only</h1>
        <p>Only staff roles with patient write access can create patients.</p>
      </main>
    );
  }

  return (
    <Suspense fallback={<p>Loading patient form...</p>}>
      <NewPatientForm />
    </Suspense>
  );
}

function canManagePatientFormRole(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "veterinarian" ||
    role === "technician" ||
    role === "front_desk"
  );
}

function speciesValue(value: string): PatientSpecies {
  return (PATIENT_SPECIES as readonly string[]).includes(value)
    ? (value as PatientSpecies)
    : "canine";
}

function sexValue(value: string): PatientSex | undefined {
  return sexOptions.some((option) => option.value === value)
    ? (value as PatientSex)
    : undefined;
}

function NewPatientForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState({
    clientId: "",
    name: "",
    species: "canine" as PatientSpecies,
    breed: "",
    sex: "",
    dob: "",
    color: "",
    microchipNumber: "",
  });
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preselectedClientId = searchParams.get("clientId") ?? "";
  const preselectedClientName = (searchParams.get("clientName") ?? "").trim();
  const trimmedClientSearch = clientSearch.trim();
  const canSearchClients = isClientSearchInputValid(clientSearch);

  const {
    data: clientResults,
    isLoading: isSearchingClients,
    error: clientSearchError,
  } = trpc.clients.search.useQuery(
    { query: trimmedClientSearch },
    { enabled: canSearchClients },
  );
  const clientSearchMissing =
    canSearchClients &&
    !selectedClientName &&
    !isSearchingClients &&
    !clientSearchError &&
    !clientResults;

  useEffect(() => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        preselectedClientId,
      ) ||
      !preselectedClientName ||
      preselectedClientName.length > CLIENT_SEARCH_MAX_LENGTH
    ) {
      return;
    }
    setForm((current) =>
      current.clientId
        ? current
        : { ...current, clientId: preselectedClientId },
    );
    setSelectedClientName((current) => current || preselectedClientName);
  }, [preselectedClientId, preselectedClientName]);

  const createPatient = trpc.patients.create.useMutation({
    onSuccess: (patient) => {
      router.push(`/patients/${patient.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit =
    !!form.clientId &&
    isRequiredPatientTextValid(form.name, PATIENT_NAME_MAX_LENGTH) &&
    isOptionalPatientTextValid(form.breed, PATIENT_BREED_MAX_LENGTH) &&
    isOptionalPatientTextValid(form.color, PATIENT_COLOR_MAX_LENGTH) &&
    isOptionalPatientTextValid(
      form.microchipNumber,
      PATIENT_MICROCHIP_NUMBER_MAX_LENGTH,
    );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const submittedDob =
      (event.currentTarget.elements.namedItem("dob") as HTMLInputElement | null)
        ?.value ?? form.dob;

    if (!form.clientId) {
      setError("Please select an owner (client).");
      return;
    }
    if (!form.name.trim()) {
      setError("Patient name is required.");
      return;
    }
    if (!canSubmit) {
      setError("Check required fields and field lengths.");
      return;
    }

    createPatient.mutate({
      clientId: form.clientId,
      name: form.name.trim(),
      species: form.species,
      breed: form.breed.trim() || undefined,
      sex: sexValue(form.sex),
      dob: submittedDob || undefined,
      color: form.color.trim() || undefined,
      microchipNumber: form.microchipNumber.trim() || undefined,
    });
  };

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const selectClient = (client: {
    id: string;
    firstName: string;
    lastName: string;
  }) => {
    setForm((prev) => ({ ...prev, clientId: client.id }));
    setSelectedClientName(`${client.firstName} ${client.lastName}`);
    setClientSearch("");
    setShowClientDropdown(false);
  };

  return (
    <main>
      <p>
        <a href="/patients">Back to Patients</a>
      </p>
      <h1>New Patient</h1>
      <p>Add a new patient record</p>
      {error ? <p>{error}</p> : null}
      <form onSubmit={handleSubmit}>
        <label>
          Owner (Client)
          {selectedClientName ? (
            <>
              <span>{selectedClientName}</span>
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, clientId: "" }));
                  setSelectedClientName("");
                }}
              >
                Change
              </button>
            </>
          ) : (
            <>
              <input
                placeholder="Search clients by name or email..."
                value={clientSearch}
                maxLength={CLIENT_SEARCH_MAX_LENGTH}
                onChange={(event) => {
                  setClientSearch(event.target.value);
                  setShowClientDropdown(true);
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => {
                  setTimeout(() => setShowClientDropdown(false), 200);
                }}
              />
              {showClientDropdown && canSearchClients ? (
                clientSearchError || clientSearchMissing ? (
                  <p>
                    {clientSearchError?.message ??
                      "Unable to search clients. Please retry."}
                  </p>
                ) : isSearchingClients ? (
                  <p>Searching clients...</p>
                ) : clientResults && clientResults.length > 0 ? (
                  <ul>
                    {clientResults.map((client) => (
                      <li key={client.id}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectClient(client)}
                        >
                          {client.firstName} {client.lastName}
                          {client.email || client.phone
                            ? ` · ${client.email || client.phone}`
                            : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No clients found</p>
                )
              ) : null}
            </>
          )}
        </label>
        <label>
          Patient Name
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            maxLength={PATIENT_NAME_MAX_LENGTH}
            required
          />
        </label>
        <label>
          Species
          <select
            value={form.species}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                species: speciesValue(event.target.value),
              }))
            }
          >
            {PATIENT_SPECIES_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Breed
          <input
            value={form.breed}
            onChange={(event) => updateField("breed", event.target.value)}
            maxLength={PATIENT_BREED_MAX_LENGTH}
          />
        </label>
        <label>
          Sex
          <select
            value={form.sex}
            onChange={(event) => updateField("sex", event.target.value)}
          >
            <option value="">Select sex...</option>
            {sexOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date of Birth
          <input
            name="dob"
            type="date"
            value={form.dob}
            onChange={(event) => updateField("dob", event.target.value)}
          />
        </label>
        <label>
          Color/Markings
          <input
            value={form.color}
            onChange={(event) => updateField("color", event.target.value)}
            maxLength={PATIENT_COLOR_MAX_LENGTH}
          />
        </label>
        <label>
          Microchip Number
          <input
            value={form.microchipNumber}
            onChange={(event) =>
              updateField("microchipNumber", event.target.value)
            }
            maxLength={PATIENT_MICROCHIP_NUMBER_MAX_LENGTH}
          />
        </label>
        <button type="submit" disabled={!canSubmit || createPatient.isPending}>
          {createPatient.isPending ? "Creating..." : "Create Patient"}
        </button>
        <button type="button" onClick={() => router.push("/patients")}>
          Cancel
        </button>
      </form>
    </main>
  );
}
