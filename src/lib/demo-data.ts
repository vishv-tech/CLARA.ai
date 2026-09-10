import type { Assignment, AttendanceRecord, TimetableEntry, Weekday } from "./types";

export const timetable: TimetableEntry[] = [
  { id: "mon-ai-0900", day: "Monday", subject: "Artificial Intelligence", startTime: "09:00", endTime: "10:00", room: "Room 202", type: "class" },
  { id: "mon-asp-1000", day: "Monday", subject: "ASP.NET", startTime: "10:00", endTime: "11:00", room: "Room 301", type: "class" },
  { id: "mon-free-1100", day: "Monday", subject: "Free Period", startTime: "11:00", endTime: "12:00", type: "free" },
  { id: "mon-dbms-1200", day: "Monday", subject: "Database Management Systems", startTime: "12:00", endTime: "13:00", room: "Lab 3", type: "class" },
  { id: "mon-os-1400", day: "Monday", subject: "Operating Systems", startTime: "14:00", endTime: "15:00", room: "Room 105", type: "class" },
  { id: "tue-asp-0900", day: "Tuesday", subject: "ASP.NET", startTime: "09:00", endTime: "10:00", room: "Room 301", type: "class" },
  { id: "tue-ai-1000", day: "Tuesday", subject: "Artificial Intelligence", startTime: "10:00", endTime: "11:00", room: "Room 202", type: "class" },
  { id: "tue-dbms-1100", day: "Tuesday", subject: "Database Management Systems", startTime: "11:00", endTime: "12:00", room: "Lab 3", type: "class" },
  { id: "tue-free-1200", day: "Tuesday", subject: "Free Period", startTime: "12:00", endTime: "13:00", type: "free" },
  { id: "tue-cn-1400", day: "Tuesday", subject: "Computer Networks", startTime: "14:00", endTime: "15:00", room: "Room 204", type: "class" },
  { id: "wed-dbms-0900", day: "Wednesday", subject: "Database Management Systems", startTime: "09:00", endTime: "10:00", room: "Lab 3", type: "class" },
  { id: "wed-os-1000", day: "Wednesday", subject: "Operating Systems", startTime: "10:00", endTime: "11:00", room: "Room 105", type: "class" },
  { id: "wed-ai-1100", day: "Wednesday", subject: "Artificial Intelligence", startTime: "11:00", endTime: "12:00", room: "Room 202", type: "class" },
  { id: "wed-asp-1200", day: "Wednesday", subject: "ASP.NET", startTime: "12:00", endTime: "13:00", room: "Room 301", type: "class" },
  { id: "wed-free-1400", day: "Wednesday", subject: "Free Period", startTime: "14:00", endTime: "15:00", type: "free" },
  { id: "thu-cn-0900", day: "Thursday", subject: "Computer Networks", startTime: "09:00", endTime: "10:00", room: "Room 204", type: "class" },
  { id: "thu-dbms-1000", day: "Thursday", subject: "Database Management Systems", startTime: "10:00", endTime: "11:00", room: "Lab 3", type: "class" },
  { id: "thu-free-1100", day: "Thursday", subject: "Free Period", startTime: "11:00", endTime: "12:00", type: "free" },
  { id: "thu-ai-1200", day: "Thursday", subject: "Artificial Intelligence", startTime: "12:00", endTime: "13:00", room: "Room 202", type: "class" },
  { id: "thu-asp-1400", day: "Thursday", subject: "ASP.NET", startTime: "14:00", endTime: "15:00", room: "Room 301", type: "class" },
  { id: "fri-os-0900", day: "Friday", subject: "Operating Systems", startTime: "09:00", endTime: "10:00", room: "Room 105", type: "class" },
  { id: "fri-ai-1000", day: "Friday", subject: "Artificial Intelligence", startTime: "10:00", endTime: "11:00", room: "Room 202", type: "class" },
  { id: "fri-asp-1100", day: "Friday", subject: "ASP.NET", startTime: "11:00", endTime: "12:00", room: "Room 301", type: "class" },
  { id: "fri-dbms-1200", day: "Friday", subject: "Database Management Systems", startTime: "12:00", endTime: "13:00", room: "Lab 3", type: "class" },
  { id: "fri-project-1400", day: "Friday", subject: "Project Lab", startTime: "14:00", endTime: "16:00", room: "Innovation Lab", type: "class" },
];

export const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOffset(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

export function createDemoAssignments(): Assignment[] {
  return [
    { id: "demo-assignment-ai", title: "AI Assignment", subject: "Artificial Intelligence", dueDate: dateOffset(1), dueTime: "23:59", priority: "high", completed: false },
    { id: "demo-assignment-dbms", title: "Normalize Library Schema", subject: "Database Management Systems", dueDate: dateOffset(4), dueTime: "18:00", priority: "medium", completed: false },
  ];
}

const attendanceSeed: Array<[string, number, number, number]> = [
  ["Artificial Intelligence", 18, 4, 1],
  ["ASP.NET", 16, 6, 0],
  ["Database Management Systems", 19, 3, 1],
  ["Operating Systems", 15, 5, 0],
  ["Computer Networks", 14, 6, 1],
];

export function createDemoAttendance(): AttendanceRecord[] {
  const queues = attendanceSeed.map(([subject, present, absent, cancelled], subjectIndex) => ({
    subject,
    subjectIndex,
    statuses: [
      ...Array.from({ length: present }, () => "present" as const),
      ...Array.from({ length: absent }, () => "absent" as const),
      ...Array.from({ length: cancelled }, () => "cancelled" as const),
    ],
  }));
  const records: AttendanceRecord[] = [];
  let cursor = -1;
  let index = 0;

  while (queues.some((queue) => queue.statuses.length > 0)) {
    for (const queue of queues) {
      const status = queue.statuses.shift();
      if (!status) continue;
      cursor -= 1;
      records.push({
        id: `demo-attendance-${queue.subjectIndex}-${index}`,
        timetableEntryId: `historical-${queue.subjectIndex}`,
        subject: queue.subject,
        date: dateOffset(cursor),
        startTime: "09:00",
        endTime: "10:00",
        status,
      });
      index += 1;
    }
  }

  return records;
}
