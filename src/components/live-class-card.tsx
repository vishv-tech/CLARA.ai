import { formatTime, type ScheduleState } from "@/lib/academic-utils";
import { AttendanceAction } from "./attendance-action";
import { ClockIcon } from "./icons";

export function LiveClassCard({ state, now }: { state: ScheduleState; now: Date }) {
  const entry = state.activeEntry ?? state.nextEntry;

  return (
    <section className="live-card">
      <div className="live-glow" />
      <div className="live-topline">
        <span className="live-status"><i />{state.kind === "current" ? "CURRENT CLASS" : state.kind === "next" ? "NEXT CLASS" : state.kind === "free" ? "FREE PERIOD" : "TODAY'S SCHEDULE"}</span>
        <span className="live-time"><ClockIcon />Live timetable</span>
      </div>

      {state.kind === "current" && entry && (
        <>
          <div className="live-content">
            <div><p>Now learning</p><h2>{entry.subject}</h2><span>{formatTime(entry.startTime)} – {formatTime(entry.endTime)} <b>•</b> {entry.room}</span></div>
            <div className="countdown"><strong>{state.minutes}</strong><span>min remaining</span></div>
          </div>
          <AttendanceAction entry={entry} now={now} />
        </>
      )}

      {state.kind === "next" && entry && (
        <div className="live-content">
          <div><p>Up next</p><h2>{entry.subject}</h2><span>{formatTime(entry.startTime)} – {formatTime(entry.endTime)} <b>•</b> {entry.room}</span></div>
          <div className="countdown"><strong>{state.minutes}</strong><span>min to start</span></div>
        </div>
      )}

      {state.kind === "free" && (
        <div className="live-content">
          <div><p>Time to reset</p><h2>Free period</h2>{state.nextEntry ? <span>Next: {state.nextEntry.subject} at {formatTime(state.nextEntry.startTime)} <b>•</b> {state.nextEntry.room}</span> : <span>No more classes scheduled today.</span>}</div>
          <div className="free-orbit">☕</div>
        </div>
      )}

      {(state.kind === "complete" || state.kind === "no-classes") && (
        <div className="live-content">
          <div>
            <p>{state.kind === "no-classes" ? "No classes today" : "Day complete"}</p>
            <h2>{state.kind === "no-classes" ? "Your day is open ✨" : "Classes completed for today 🎉"}</h2>
            {entry && <span>Next: {state.nextDay}, {formatTime(entry.startTime)} — {entry.subject}</span>}
          </div>
          <div className="free-orbit">✓</div>
        </div>
      )}
    </section>
  );
}
