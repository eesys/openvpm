"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import {
  APPOINTMENT_DURATION_MAX_MINUTES,
  APPOINTMENT_DURATION_MIN_MINUTES,
  APPOINTMENT_NOTES_MAX_LENGTH,
  APPOINTMENT_PATIENT_SEARCH_MAX_LENGTH,
  isAppointmentDateInputValid,
  isAppointmentDurationInputValid,
  isAppointmentNotesInputValid,
  isAppointmentPatientSearchInputValid,
} from "@/lib/scheduling/appointment-policy";
import {
  dateInputTimeUtcInstant,
  formatDateInputForTimeZone,
} from "@/lib/date-input";

function canCreateAppointmentsRole(role?: string | null): boolean {
  return role === "admin" || role === "veterinarian" || role === "front_desk";
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<p>Loading schedule...</p>}>
      <SchedulePageContent />
    </Suspense>
  );
}

function SchedulePageContent() {
  const router = useRouter();
  const { data: session, status } = useSession();

  if (status === "loading") return <p>Loading schedule...</p>;
  if (status === "unauthenticated") {
    router.push("/login");
    return <p>Loading schedule...</p>;
  }

  return (
    <ScheduleDay
      canCreate={canCreateAppointmentsRole(session?.user?.role)}
    />
  );
}

function ScheduleDay({ canCreate }: { canCreate: boolean }) {
  const searchParams = useSearchParams();
  const settings = trpc.appointments.calendarSettings.useQuery();
  const timeZone = settings.data?.timezone ?? "America/New_York";
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!date && settings.data) {
      setDate(formatDateInputForTimeZone(new Date(), timeZone));
    }
  }, [date, settings.data, timeZone]);

  const appointments = trpc.appointments.list.useQuery(
    { startDate: date, endDate: date },
    { enabled: isAppointmentDateInputValid(date) },
  );

  return (
    <main>
      <p>
        <a href="/">Home</a>
      </p>
      <h1>Schedule</h1>
      <label>
        Date{" "}
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {appointments.error ? <p>{appointments.error.message}</p> : null}
      <ul>
        {(appointments.data ?? []).map((appointment) => (
          <li key={appointment.id}>
            <a href={`/encounters/${appointment.id}`}>
              {formatTime(appointment.startTime, timeZone)}–
              {formatTime(appointment.endTime, timeZone)}
              {" · "}
              {appointment.patientName ?? "No patient"}
              {appointment.doctorName ? ` · ${appointment.doctorName}` : ""}
              {appointment.typeName ? ` · ${appointment.typeName}` : ""}
              {` · ${appointment.status}`}
            </a>
          </li>
        ))}
      </ul>
      {!appointments.isLoading && (appointments.data?.length ?? 0) === 0 ? (
        <p>No appointments this day.</p>
      ) : null}
      {canCreate ? (
        <BookingForm
          date={date}
          timeZone={timeZone}
          initialPatientSearch={searchParams.get("patient") ?? ""}
          onBooked={() => appointments.refetch()}
        />
      ) : (
        <p>Only staff who can book appointments can add one.</p>
      )}
    </main>
  );
}

function BookingForm({
  date,
  timeZone,
  initialPatientSearch,
  onBooked,
}: {
  date: string;
  timeZone: string;
  initialPatientSearch: string;
  onBooked: () => void;
}) {
  const [patientSearch, setPatientSearch] = useState(initialPatientSearch);
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trimmedSearch = patientSearch.trim();
  const canSearch = isAppointmentPatientSearchInputValid(patientSearch);
  const patients = trpc.patients.search.useQuery(
    { query: trimmedSearch },
    { enabled: canSearch && trimmedSearch.length > 0 && !selectedPatient },
  );
  const doctors = trpc.appointments.listDoctors.useQuery();
  const types = trpc.appointments.listTypes.useQuery();
  const createAppointment = trpc.appointments.create.useMutation({
    onSuccess: () => {
      setError(null);
      setNotes("");
      onBooked();
    },
    onError: (err) => setError(err.message),
  });

  useEffect(() => {
    const selected = types.data?.find((type) => type.id === typeId);
    if (selected?.durationMinutes) setDuration(selected.durationMinutes);
  }, [typeId, types.data]);

  const canSubmit =
    Boolean(selectedPatient) &&
    Boolean(doctorId) &&
    isAppointmentDateInputValid(date) &&
    /^\d{2}:\d{2}$/.test(startTime) &&
    isAppointmentDurationInputValid(duration) &&
    isAppointmentNotesInputValid(notes) &&
    !createAppointment.isPending;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!selectedPatient || !doctorId || !canSubmit) {
          setError("Choose a patient, a doctor, and a valid time.");
          return;
        }
        const [hour = 0, minute = 0] = startTime.split(":").map(Number);
        const start = dateInputTimeUtcInstant(
          date,
          { hour, minute },
          timeZone,
        );
        const end = new Date(start.getTime() + duration * 60_000);
        createAppointment.mutate({
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          patientId: selectedPatient.id,
          doctorId,
          typeId: typeId || undefined,
          notes: notes.trim() || undefined,
        });
      }}
    >
      <h2>Book appointment</h2>
      {error ? <p>{error}</p> : null}
      <label>
        Patient
        {selectedPatient ? (
          <>
            <span>{selectedPatient.name}</span>
            <button
              type="button"
              onClick={() => {
                setSelectedPatient(null);
                setPatientSearch("");
              }}
            >
              Change
            </button>
          </>
        ) : (
          <>
            <input
              value={patientSearch}
              maxLength={APPOINTMENT_PATIENT_SEARCH_MAX_LENGTH}
              placeholder="Search patients by name"
              onChange={(event) => setPatientSearch(event.target.value)}
            />
            {canSearch && trimmedSearch ? (
              patients.isLoading ? (
                <p>Searching patients...</p>
              ) : patients.data && patients.data.length > 0 ? (
                <ul>
                  {patients.data.map((patient) => (
                    <li key={patient.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPatient({
                            id: patient.id,
                            name: patient.name,
                          });
                        }}
                      >
                        {patient.name}
                        {patient.clientFirstName
                          ? ` · ${patient.clientFirstName} ${patient.clientLastName ?? ""}`
                          : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No patients found</p>
              )
            ) : null}
          </>
        )}
      </label>
      <label>
        Doctor
        <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
          <option value="">Select a doctor...</option>
          {(doctors.data ?? []).map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Type
        <select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
          <option value="">No type</option>
          {(types.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} · {type.durationMinutes} min
            </option>
          ))}
        </select>
      </label>
      <label>
        Start
        <input
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
        />
      </label>
      <label>
        Duration (minutes)
        <input
          type="number"
          min={APPOINTMENT_DURATION_MIN_MINUTES}
          max={APPOINTMENT_DURATION_MAX_MINUTES}
          step={5}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
      </label>
      <label>
        Notes
        <textarea
          value={notes}
          maxLength={APPOINTMENT_NOTES_MAX_LENGTH}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <button type="submit" disabled={!canSubmit}>
        {createAppointment.isPending ? "Booking..." : "Book appointment"}
      </button>
    </form>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
