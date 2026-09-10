"use client";

import { useEffect, useState } from "react";
import { getAttendance, saveAttendance } from "@/lib/storage";
import { toDateKey } from "@/lib/academic-utils";
import type { AttendanceRecord, AttendanceStatus, TimetableEntry } from "@/lib/types";

const labels: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  cancelled: "Cancelled",
};

export function AttendanceAction({ entry, now }: { entry: TimetableEntry; now: Date }) {
  const [record, setRecord] = useState<AttendanceRecord | undefined>();
  const [editing, setEditing] = useState(false);
  const date = toDateKey(now);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRecord(
        getAttendance().find(
          (item) => item.timetableEntryId === entry.id && item.date === date,
        ),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [date, entry.id]);

  function mark(status: AttendanceStatus) {
    const nextRecord: AttendanceRecord = {
      id: record?.id ?? `attendance-${Date.now()}`,
      timetableEntryId: entry.id,
      subject: entry.subject,
      date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      status,
    };
    saveAttendance(nextRecord);
    setRecord(nextRecord);
    setEditing(false);
  }

  if (record && !editing) {
    return (
      <div className={`attendance-confirmed ${record.status}`}>
        <span>Attendance marked: <strong>{labels[record.status]}</strong> {record.status === "present" ? "✓" : ""}</span>
        <button type="button" onClick={() => setEditing(true)}>Edit</button>
      </div>
    );
  }

  return (
    <div className="attendance-action">
      <span>Mark attendance</span>
      <div className="attendance-buttons">
        <button type="button" className="present" onClick={() => mark("present")}>✓ Present</button>
        <button type="button" className="absent" onClick={() => mark("absent")}>× Absent</button>
        <button type="button" className="cancelled" onClick={() => mark("cancelled")}>— Cancelled</button>
      </div>
    </div>
  );
}
