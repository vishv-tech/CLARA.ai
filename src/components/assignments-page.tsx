"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatDueLabel, formatTimeRemaining, parseAssignmentDate, toDateKey } from "@/lib/academic-utils";
import { DATA_CHANGED_EVENT, deleteAssignment, getAssignments, saveAssignment, toggleAssignment } from "@/lib/storage";
import type { Assignment, AssignmentPriority } from "@/lib/types";
import { PageHeader } from "./page-header";

const subjects = ["Artificial Intelligence", "ASP.NET", "Database Management Systems", "Operating Systems", "Computer Networks", "Project Lab"];

export function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [today, setToday] = useState("");
  const [now, setNow] = useState<Date>();

  useEffect(() => {
    const refresh = () => setAssignments(getAssignments());
    const frame = window.requestAnimationFrame(() => {
      refresh();
      setToday(toDateKey(new Date()));
      setNow(new Date());
    });
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(DATA_CHANGED_EVENT, refresh);
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    saveAssignment({
      id: `assignment-${Date.now()}`,
      title: String(data.get("title")),
      subject: String(data.get("subject")),
      dueDate: String(data.get("dueDate")),
      dueTime: String(data.get("dueTime")),
      priority: String(data.get("priority")) as AssignmentPriority,
      completed: false,
    });
    event.currentTarget.reset();
    setFormOpen(false);
  }

  const ordered = [...assignments].sort((a, b) => Number(a.completed) - Number(b.completed) || parseAssignmentDate(a).getTime() - parseAssignmentDate(b).getTime());

  return (
    <div>
      <PageHeader eyebrow="DEADLINE CONTROL" title="Assignments" description="Keep every submission visible, sorted, and under control." action={<button className="primary-button" type="button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? "Close" : "+ Add assignment"}</button>} />

      {formOpen && (
        <form className="assignment-form panel" onSubmit={submit}>
          <label><span>Title</span><input required name="title" placeholder="e.g. AI Assignment" /></label>
          <label><span>Subject</span><select required name="subject" defaultValue=""><option value="" disabled>Select subject</option>{subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          <label><span>Due date</span><input required type="date" name="dueDate" min={today} /></label>
          <label><span>Due time</span><input required type="time" name="dueTime" defaultValue="23:59" /></label>
          <label><span>Priority</span><select name="priority" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <button className="primary-button" type="submit">Save assignment</button>
        </form>
      )}

      <div className="assignment-stats"><div className="panel"><span>Active</span><strong>{assignments.filter((item) => !item.completed).length}</strong></div><div className="panel"><span>High priority</span><strong>{assignments.filter((item) => !item.completed && item.priority === "high").length}</strong></div><div className="panel"><span>Completed</span><strong>{assignments.filter((item) => item.completed).length}</strong></div></div>

      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">ALL TASKS</p><h2>Your academic queue</h2></div></div>
        <div className="assignment-list">
          {ordered.map((assignment) => {
            const due = parseAssignmentDate(assignment);
            return (
              <article className={`assignment-card panel ${assignment.completed ? "completed" : ""}`} key={assignment.id}>
                <button className="completion-check" type="button" onClick={() => toggleAssignment(assignment.id)} aria-label={assignment.completed ? "Mark incomplete" : "Mark complete"}>{assignment.completed ? "✓" : ""}</button>
                <div className="assignment-main"><div><h3>{assignment.title}</h3><p>{assignment.subject}</p></div><span className={`priority-badge ${assignment.priority}`}>{assignment.priority}</span></div>
                <div className="assignment-due"><span>{due.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} at {due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>{!assignment.completed && now && <strong>{formatDueLabel(due, now)} · {formatTimeRemaining(due, now)}</strong>}</div>
                <button type="button" className="delete-button" onClick={() => deleteAssignment(assignment.id)} aria-label={`Delete ${assignment.title}`}>Delete</button>
              </article>
            );
          })}
          {!assignments.length && <div className="empty-state panel">No assignments yet. Add your first deadline above.</div>}
        </div>
      </section>
    </div>
  );
}
