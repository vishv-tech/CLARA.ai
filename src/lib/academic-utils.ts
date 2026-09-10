import { timetable, weekdays } from "./demo-data";
import type { Assignment, AttendanceRecord, SubjectAttendance, TimetableEntry, Weekday } from "./types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type ScheduleState = {
  kind: "current" | "next" | "free" | "complete" | "no-classes";
  activeEntry?: TimetableEntry;
  nextEntry?: TimetableEntry;
  nextDay?: string;
  minutes?: number;
};

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function getDayEntries(day: Weekday) {
  return timetable.filter((entry) => entry.day === day);
}

function findNextClass(date: Date) {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(date);
    candidate.setDate(date.getDate() + offset);
    const name = DAY_NAMES[candidate.getDay()] as Weekday;
    const entry = timetable.find((item) => item.day === name && item.type === "class");
    if (entry) return { entry, day: offset === 1 ? "Tomorrow" : name };
  }
  return undefined;
}

export function getScheduleState(now: Date): ScheduleState {
  const dayName = DAY_NAMES[now.getDay()] as Weekday;
  const entries = weekdays.includes(dayName) ? getDayEntries(dayName) : [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const active = entries.find(
    (entry) => currentMinutes >= minutesFromTime(entry.startTime) && currentMinutes < minutesFromTime(entry.endTime),
  );
  const nextToday = entries.find(
    (entry) => entry.type === "class" && minutesFromTime(entry.startTime) > currentMinutes,
  );

  if (active?.type === "class") {
    return {
      kind: "current",
      activeEntry: active,
      minutes: Math.max(1, minutesFromTime(active.endTime) - currentMinutes),
    };
  }

  if (active?.type === "free") {
    return { kind: "free", activeEntry: active, nextEntry: nextToday };
  }

  if (nextToday) {
    const firstClass = entries.find((entry) => entry.type === "class");
    const beforeFirst = firstClass && currentMinutes < minutesFromTime(firstClass.startTime);
    return {
      kind: beforeFirst ? "next" : "free",
      nextEntry: nextToday,
      minutes: minutesFromTime(nextToday.startTime) - currentMinutes,
    };
  }

  const next = findNextClass(now);
  return {
    kind: entries.length ? "complete" : "no-classes",
    nextEntry: next?.entry,
    nextDay: next?.day,
  };
}

export function parseAssignmentDate(assignment: Assignment) {
  const [year, month, day] = assignment.dueDate.split("-").map(Number);
  const [hours, minutes] = assignment.dueTime.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

export function getUpcomingAssignments(assignments: Assignment[], now = new Date()) {
  return assignments
    .filter((assignment) => !assignment.completed && parseAssignmentDate(assignment).getTime() >= now.getTime())
    .sort((a, b) => parseAssignmentDate(a).getTime() - parseAssignmentDate(b).getTime());
}

export function formatTimeRemaining(due: Date, now = new Date()) {
  const difference = Math.max(0, due.getTime() - now.getTime());
  const totalMinutes = Math.floor(difference / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function formatDueLabel(due: Date, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const dayDifference = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (dayDifference === 0) return "Due today";
  if (dayDifference === 1) return "Due tomorrow";
  return `Due ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export function calculateAttendanceStats(records: AttendanceRecord[]): SubjectAttendance[] {
  const groups = new Map<string, AttendanceRecord[]>();
  records.forEach((record) => groups.set(record.subject, [...(groups.get(record.subject) ?? []), record]));

  return Array.from(groups.entries())
    .map(([subject, items]) => {
      const present = items.filter((item) => item.status === "present").length;
      const absent = items.filter((item) => item.status === "absent").length;
      const cancelled = items.filter((item) => item.status === "cancelled").length;
      const conducted = present + absent;
      const percentage = conducted ? (present / conducted) * 100 : 0;
      let guidance = "No conducted classes yet";

      if (conducted > 0 && percentage >= 75) {
        const canMiss = Math.max(0, Math.floor(present / 0.75 - conducted));
        if (canMiss === 0) guidance = "Attend the next class to stay at or above 75%";
        else guidance = canMiss === 1 ? "You can miss 1 class and stay safe" : `You can miss ${canMiss} classes and stay safe`;
      } else if (conducted > 0) {
        const mustAttend = Math.ceil((0.75 * conducted - present) / 0.25);
        guidance = mustAttend === 1 ? "Attend the next class to reach 75%" : `Attend ${mustAttend} classes in a row to reach 75%`;
      }

      return { subject, present, absent, cancelled, conducted, percentage, guidance };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}
