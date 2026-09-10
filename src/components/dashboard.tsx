"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { calculateAttendanceStats, formatDueLabel, formatTimeRemaining, getScheduleState, getUpcomingAssignments, parseAssignmentDate } from "@/lib/academic-utils";
import { DATA_CHANGED_EVENT, getAssignments, getAttendance } from "@/lib/storage";
import type { Assignment, AttendanceRecord } from "@/lib/types";
import { ArrowIcon, BookIcon, CalendarIcon, CheckIcon, ClipboardIcon } from "./icons";
import { LiveClassCard } from "./live-class-card";
import { NudgeCard } from "./nudge-card";

const quickActions = [
  { href: "/study-workspace", title: "Study with SAGE", note: "AI workspace", icon: BookIcon, tone: "violet" },
  { href: "/timetable", title: "View Timetable", note: "Plan your week", icon: CalendarIcon, tone: "cyan" },
  { href: "/assignments", title: "Add Assignment", note: "Track a deadline", icon: ClipboardIcon, tone: "amber" },
  { href: "/attendance", title: "Check Attendance", note: "Stay above 75%", icon: CheckIcon, tone: "green" },
];

export function Dashboard() {
  const [now, setNow] = useState<Date>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    const refresh = () => {
      setAssignments(getAssignments());
      setAttendance(getAttendance());
    };
    const frame = window.requestAnimationFrame(() => {
      refresh();
      setNow(new Date());
    });
    const interval = window.setInterval(() => setNow(new Date()), 15_000);
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.removeEventListener(DATA_CHANGED_EVENT, refresh);
    };
  }, []);

  const stats = useMemo(() => calculateAttendanceStats(attendance), [attendance]);
  if (!now) return <div className="dashboard-loading"><div /><div /><div /></div>;

  const schedule = getScheduleState(now);
  const deadlines = getUpcomingAssignments(assignments, now).slice(0, 3);
  const greeting = now.getHours() < 12 ? "Good Morning" : now.getHours() < 17 ? "Good Afternoon" : "Good Evening";
  const overallPresent = stats.reduce((sum, item) => sum + item.present, 0);
  const overallConducted = stats.reduce((sum, item) => sum + item.conducted, 0);
  const overall = overallConducted ? (overallPresent / overallConducted) * 100 : 0;

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div><p className="eyebrow">YOUR ACADEMIC COMMAND CENTER</p><h1>{greeting}, Vishv <span>👋</span></h1><p>Here&apos;s what your academic day looks like.</p></div>
        <div className="date-chip"><CalendarIcon /><span>{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span></div>
      </header>

      <NudgeCard />
      <LiveClassCard state={schedule} now={now} />

      <div className="dashboard-grid">
        <section className="panel deadlines-panel">
          <div className="section-heading"><div><p className="eyebrow">STAY AHEAD</p><h2>Upcoming deadlines</h2></div><Link href="/assignments">View all <ArrowIcon /></Link></div>
          <div className="deadline-list">
            {deadlines.length ? deadlines.map((assignment) => {
              const due = parseAssignmentDate(assignment);
              return (
                <div className="deadline-row" key={assignment.id}>
                  <div className={`deadline-date ${assignment.priority}`}><strong>{due.getDate()}</strong><span>{due.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}</span></div>
                  <div className="deadline-copy"><h3>{assignment.title}</h3><p>{assignment.subject}</p><span>{formatDueLabel(due, now)} · {formatTimeRemaining(due, now)}</span></div>
                  <span className={`priority-badge ${assignment.priority}`}>{assignment.priority}</span>
                </div>
              );
            }) : <div className="empty-state">All caught up — no upcoming deadlines.</div>}
          </div>
        </section>

        <section className="panel attendance-panel">
          <div className="section-heading"><div><p className="eyebrow">ATTENDANCE PULSE</p><h2>Your standing</h2></div><Link href="/attendance">Details <ArrowIcon /></Link></div>
          <div className="overall-ring" style={{ "--progress": `${Math.min(overall, 100) * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{overall.toFixed(1)}%</strong><span>overall</span></div>
          </div>
          <div className="mini-stats">
            {stats.slice(0, 3).map((item) => <div key={item.subject}><span>{item.subject === "Artificial Intelligence" ? "AI" : item.subject}</span><strong className={item.percentage < 75 ? "warning-text" : "safe-text"}>{item.percentage.toFixed(0)}%</strong></div>)}
          </div>
        </section>
      </div>

      <section className="quick-section">
        <div className="section-heading"><div><p className="eyebrow">ONE CLICK AWAY</p><h2>Quick actions</h2></div></div>
        <div className="quick-grid">
          {quickActions.map(({ href, title, note, icon: Icon, tone }) => <Link href={href} className="quick-card" key={href}><span className={`quick-icon ${tone}`}><Icon /></span><div><strong>{title}</strong><span>{note}</span></div><ArrowIcon className="quick-arrow" /></Link>)}
        </div>
      </section>
    </div>
  );
}
