import { createDemoAssignments, createDemoAttendance } from "./demo-data";
import type { Assignment, AttendanceRecord } from "./types";

const ASSIGNMENTS_KEY = "sage.assignments.v1";
const ATTENDANCE_KEY = "sage.attendance.v1";
const NUDGE_KEY = "sage.nudge.shown";
export const DATA_CHANGED_EVENT = "sage:data-changed";

function canUseBrowserStorage() {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: () => T): T {
  if (!canUseBrowserStorage()) return fallback();
  const stored = window.localStorage.getItem(key);
  if (stored !== null) {
    try {
      return JSON.parse(stored) as T;
    } catch {
      // Replace malformed prototype data with a valid seed.
    }
  }
  const value = fallback();
  window.localStorage.setItem(key, JSON.stringify(value));
  return value;
}

function writeJson<T>(key: string, value: T) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: key }));
}

export function getAssignments() {
  return readJson<Assignment[]>(ASSIGNMENTS_KEY, createDemoAssignments);
}

export function saveAssignment(assignment: Assignment) {
  writeJson(ASSIGNMENTS_KEY, [...getAssignments(), assignment]);
}

export function toggleAssignment(id: string) {
  writeJson(
    ASSIGNMENTS_KEY,
    getAssignments().map((assignment) =>
      assignment.id === id ? { ...assignment, completed: !assignment.completed } : assignment,
    ),
  );
}

export function deleteAssignment(id: string) {
  writeJson(ASSIGNMENTS_KEY, getAssignments().filter((assignment) => assignment.id !== id));
}

export function getAttendance() {
  return readJson<AttendanceRecord[]>(ATTENDANCE_KEY, createDemoAttendance);
}

export function saveAttendance(record: AttendanceRecord) {
  const records = getAttendance();
  const existingIndex = records.findIndex(
    (item) => item.timetableEntryId === record.timetableEntryId && item.date === record.date,
  );

  if (existingIndex >= 0) {
    const updated = [...records];
    updated[existingIndex] = { ...record, id: records[existingIndex].id };
    writeJson(ATTENDANCE_KEY, updated);
    return;
  }

  writeJson(ATTENDANCE_KEY, [record, ...records]);
}

export function wasNudgeShown() {
  return canUseBrowserStorage() && window.sessionStorage.getItem(NUDGE_KEY) === "true";
}

export function markNudgeShown() {
  if (canUseBrowserStorage()) window.sessionStorage.setItem(NUDGE_KEY, "true");
}
