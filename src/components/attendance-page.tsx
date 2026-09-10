"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateAttendanceStats, formatTime } from "@/lib/academic-utils";
import { DATA_CHANGED_EVENT, getAttendance } from "@/lib/storage";
import type { AttendanceRecord } from "@/lib/types";
import { PageHeader } from "./page-header";

export function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => { setRecords(getAttendance()); setLoaded(true); };
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(DATA_CHANGED_EVENT, refresh);
    };
  }, []);

  const stats = useMemo(() => calculateAttendanceStats(records), [records]);
  const present = stats.reduce((sum, item) => sum + item.present, 0);
  const conducted = stats.reduce((sum, item) => sum + item.conducted, 0);
  const overall = conducted ? (present / conducted) * 100 : 0;
  const sortedRecords = [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <div>
      <PageHeader eyebrow="ATTENDANCE INTELLIGENCE" title="Attendance" description="Know where you stand before attendance becomes a problem." />
      <section className="attendance-hero panel">
        <div><p>Overall attendance</p><strong>{loaded ? `${overall.toFixed(1)}%` : "—"}</strong><span className={overall >= 75 ? "status-safe" : "status-warning"}>{overall >= 75 ? "SAFE" : "WARNING"}</span></div>
        <div className="attendance-summary"><div><strong>{present}</strong><span>Present</span></div><div><strong>{conducted - present}</strong><span>Absent</span></div><div><strong>{records.filter((r) => r.status === "cancelled").length}</strong><span>Cancelled</span></div><div><strong>75%</strong><span>Required</span></div></div>
      </section>

      <section className="content-section">
        <div className="section-heading"><div><p className="eyebrow">BY SUBJECT</p><h2>Subject overview</h2></div></div>
        <div className="subject-grid">
          {stats.map((item) => (
            <article className="subject-card panel" key={item.subject}>
              <div className="subject-card-top"><span className={item.percentage >= 75 ? "status-safe" : "status-warning"}>{item.percentage >= 75 ? "SAFE" : "WARNING"}</span><strong>{item.percentage.toFixed(1)}%</strong></div>
              <h3>{item.subject}</h3>
              <div className="progress-track"><span className={item.percentage >= 75 ? "safe" : "warning"} style={{ width: `${Math.min(item.percentage, 100)}%` }} /></div>
              <div className="subject-numbers"><span><b>{item.present}</b> Present</span><span><b>{item.absent}</b> Absent</span><span><b>{item.cancelled}</b> Cancelled</span></div>
              <p>{item.guidance}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section panel history-panel">
        <div className="section-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Attendance history</h2></div><span className="muted-note">Cancelled classes don&apos;t affect your percentage</span></div>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Date</th><th>Subject</th><th>Time</th><th>Status</th></tr></thead>
            <tbody>{sortedRecords.map((record) => <tr key={record.id}><td>{new Date(`${record.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td><td>{record.subject}</td><td>{formatTime(record.startTime)} – {formatTime(record.endTime)}</td><td><span className={`history-status ${record.status}`}>{record.status}</span></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
