import { timetable, weekdays } from "@/lib/demo-data";
import { formatTime } from "@/lib/academic-utils";
import { PageHeader } from "./page-header";

export function TimetablePage() {
  return (
    <div>
      <PageHeader eyebrow="WEEK AT A GLANCE" title="Timetable" description="One reliable schedule powering your live dashboard." action={<button className="secondary-button" disabled type="button">✦ Import Timetable with AI <span>SPRINT 2</span></button>} />
      <div className="week-grid">
        {weekdays.map((day) => (
          <section className="day-column panel" key={day}>
            <div className="day-heading"><span>{day.slice(0, 3).toUpperCase()}</span><h2>{day}</h2><small>{timetable.filter((item) => item.day === day && item.type === "class").length} classes</small></div>
            <div className="day-entries">
              {timetable.filter((entry) => entry.day === day).map((entry) => (
                <article className={`timetable-entry ${entry.type}`} key={entry.id}>
                  <span>{formatTime(entry.startTime)}</span>
                  <h3>{entry.subject}</h3>
                  <p>{entry.type === "class" ? `${formatTime(entry.endTime)} · ${entry.room}` : `${formatTime(entry.startTime)} – ${formatTime(entry.endTime)}`}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="timetable-note"><span>✦</span><p><strong>Powered by one schedule.</strong> The dashboard automatically finds your current class, free period, or next lecture from this timetable.</p></div>
    </div>
  );
}
