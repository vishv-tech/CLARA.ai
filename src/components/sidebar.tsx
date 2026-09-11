"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { BookIcon, CalendarIcon, CheckIcon, ClipboardIcon, DashboardIcon, TrophyIcon } from "./icons";

const studentLinks = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/subjects", label: "My Subjects", icon: BookIcon },
  { href: "/notices", label: "College Notices", icon: ClipboardIcon },
  { href: "/study-workspace", label: "Study Workspace", icon: BookIcon },
  { href: "/quiz", label: "Quiz", icon: ClipboardIcon },
  { href: "/timetable", label: "Timetable", icon: CalendarIcon },
  { href: "/attendance", label: "Attendance", icon: CheckIcon },
  { href: "/assignments", label: "Assignments", icon: ClipboardIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: TrophyIcon },
];

const teacherLinks = [
  { href: "/teacher", label: "Teacher Dashboard", icon: DashboardIcon },
  { href: "/teacher/notices", label: "College Notices", icon: ClipboardIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, user, signOut } = useAuth();
  const displayName = String(profile?.full_name || user?.user_metadata.full_name || "CLARA Student");
  const username = String(profile?.username || user?.user_metadata.username || "student");
  const links = profile?.role === "teacher" ? teacherLinks : studentLinks;

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return <aside className="sidebar">
    <Link href="/" className="brand" aria-label="CLARA dashboard">
      <span className="brand-mark">C</span>
      <span><strong>CLARA</strong><small>{profile?.role === "teacher" ? "TEACHER SPACE" : "STUDENT OS"}</small></span>
    </Link>
    <nav className="nav-list" aria-label="Main navigation">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <Link key={href} href={href} className={`nav-link ${active ? "active" : ""}`}>
          <Icon className="nav-icon" /><span>{label}</span>
        </Link>;
      })}
    </nav>
    <div className="profile-card">
      <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
      <div><strong>{displayName}</strong><span>@{username}</span></div>
      <button type="button" className="logout-button" onClick={() => void handleLogout()} title="Log out">Log out</button>
    </div>
  </aside>;
}
