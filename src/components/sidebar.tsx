"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, CalendarIcon, CheckIcon, ClipboardIcon, DashboardIcon, TrophyIcon } from "./icons";

const links = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/study-workspace", label: "Study Workspace", icon: BookIcon },
  { href: "/timetable", label: "Timetable", icon: CalendarIcon },
  { href: "/attendance", label: "Attendance", icon: CheckIcon },
  { href: "/assignments", label: "Assignments", icon: ClipboardIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: TrophyIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="SAGE dashboard">
        <span className="brand-mark">S</span>
        <span><strong>SAGE</strong><small>STUDENT OS</small></span>
      </Link>

      <nav className="nav-list" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`nav-link ${active ? "active" : ""}`}>
              <Icon className="nav-icon" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="profile-card">
        <div className="avatar">V</div>
        <div><strong>Vishv</strong><span>Student</span></div>
        <span className="status-dot" title="Online" />
      </div>
    </aside>
  );
}
