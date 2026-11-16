export const APPOINTMENT_NOTES_MAX_LENGTH = 2000;
export const APPOINTMENT_PATIENT_SEARCH_MAX_LENGTH = 128;
export const APPOINTMENT_DURATION_MIN_MINUTES = 5;
export const APPOINTMENT_DURATION_MAX_MINUTES = 480;

export function isAppointmentNotesInputValid(value: string): boolean {
  return value.trim().length <= APPOINTMENT_NOTES_MAX_LENGTH;
}

export function isAppointmentPatientSearchInputValid(value: string): boolean {
  return value.trim().length <= APPOINTMENT_PATIENT_SEARCH_MAX_LENGTH;
}

export function isAppointmentDurationInputValid(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= APPOINTMENT_DURATION_MIN_MINUTES &&
    value <= APPOINTMENT_DURATION_MAX_MINUTES
  );
}

export function isAppointmentDateInputValid(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isAppointmentDateTimeRangeValid(
  startTime: string,
  endTime: string,
): boolean {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const minutes = (end.getTime() - start.getTime()) / 60000;
  return Number.isFinite(minutes) && isAppointmentDurationInputValid(minutes);
}
