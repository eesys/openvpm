"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
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

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "deceased", label: "Deceased" },
] as const;

type PatientSex = (typeof sexOptions)[number]["value"];
type PatientStatus = (typeof statusOptions)[number]["value"];

export default function EditPatientPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <p>Checking patient access...</p>;
  }

  if (!canManagePatientFormRole(session?.user?.role)) {
    return (
      <main>
        <p>
          <a href={`/patients/${params.id}`}>Back to Patient</a>
        </p>
        <h1>Patient actions are read-only</h1>
        <p>Only staff roles with patient write access can edit patients.</p>
      </main>
    );
  }

  return <EditPatientForm />;
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

function statusValue(value: string): PatientStatus {
  return statusOptions.some((option) => option.value === value)
    ? (value as PatientStatus)
    : "active";
}

function EditPatientForm() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: "",
    species: "canine" as PatientSpecies,
    breed: "",
    sex: "",
    dob: "",
    color: "",
    microchipNumber: "",
    status: "active" as PatientStatus,
  });
  const [error, setError] = useState<string | null>(null);

  const {
    data: patient,
    isLoading,
    error: loadError,
  } = trpc.patients.getById.useQuery({ id: params.id }, { enabled: !!params.id });

  useEffect(() => {
    if (!patient) return;
    setForm({
      name: patient.name ?? "",
      species: speciesValue(patient.species ?? "canine"),
      breed: patient.breed ?? "",
      sex: patient.sex ?? "",
      dob: patient.dob ?? "",
      color: patient.color ?? "",
      microchipNumber: patient.microchipNumber ?? "",
      status: statusValue(patient.status ?? "active"),
    });
  }, [patient]);

  const updatePatient = trpc.patients.update.useMutation({
    onSuccess: (updatedPatient) => {
      utils.patients.getById.setData({ id: params.id }, (currentPatient) =>
        currentPatient ? { ...currentPatient, ...updatedPatient } : currentPatient,
      );
      router.push(`/patients/${params.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit =
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

    if (!patient) {
      setError("Load the patient before saving changes.");
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

    updatePatient.mutate({
      id: params.id,
      name: form.name.trim(),
      species: form.species,
      breed: form.breed.trim() || undefined,
      sex: sexValue(form.sex),
      dob: submittedDob || null,
      color: form.color.trim() || undefined,
      microchipNumber: form.microchipNumber.trim() || undefined,
      status: form.status,
    });
  };

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return <p>Loading patient...</p>;
  }

  if (loadError || !patient) {
    return (
      <main>
        <h1>Unable to load patient</h1>
        <p>
          {loadError?.message ??
            "Choose a patient from the Patients list before editing."}
        </p>
        <p>
          <a href="/patients">Back to Patients</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <p>
        <a href={`/patients/${params.id}`}>Back to Patient</a>
      </p>
      <h1>Edit Patient</h1>
      <p>Update patient information</p>
      {error ? <p>{error}</p> : null}
      <form onSubmit={handleSubmit}>
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
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                status: statusValue(event.target.value),
              }))
            }
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!canSubmit || updatePatient.isPending}>
          {updatePatient.isPending ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/patients/${params.id}`)}
        >
          Cancel
        </button>
      </form>
    </main>
  );
}
