"use client";

import { useEffect, useState } from "react";
import { calculateAttendanceStats, getUpcomingAssignments, parseAssignmentDate } from "@/lib/academic-utils";
import { getAssignments, getAttendance, markNudgeShown, wasNudgeShown } from "@/lib/storage";

export function NudgeCard() {
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (wasNudgeShown()) return;
      const now = new Date();
      const nearest = getUpcomingAssignments(getAssignments(), now)[0];
      const weakest = calculateAttendanceStats(getAttendance())
        .filter((item) => item.percentage < 75)
        .sort((a, b) => a.percentage - b.percentage)[0];

      if (nearest && parseAssignmentDate(nearest).getTime() - now.getTime() <= 48 * 60 * 60 * 1000) {
        const due = parseAssignmentDate(nearest);
        const tomorrow = due.toDateString() !== now.toDateString();
        setMessage(`Bhai ${nearest.title} tera wait kar raha hai 😭 Deadline ${tomorrow ? "kal" : "aaj"} hai.`);
      } else if (weakest) {
        setMessage(`${weakest.subject} ki attendance sambhal le bhai 💀 Abhi ${weakest.percentage.toFixed(0)}% hai.`);
      } else {
        setMessage("Aaj ka academic scene sorted hai 😎");
      }
      markNudgeShown();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!message) return null;

  return (
    <div className="nudge-card" role="status">
      <div className="sage-pulse">✦</div>
      <div><span>SAGE NUDGE</span><p>{message}</p></div>
      <button type="button" onClick={() => setMessage(undefined)} aria-label="Close reminder">×</button>
    </div>
  );
}
