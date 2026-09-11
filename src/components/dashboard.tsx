"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { calculateAttendanceStats, formatDueLabel, formatTimeRemaining, getScheduleState, getUpcomingAssignments, parseAssignmentDate } from "@/lib/academic-utils";
import { DATA_CHANGED_EVENT, getAssignments, getAttendance } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { Assignment, AttendanceRecord, OfficialSubject, StudyLeaderboardEntry, SubjectQuiz, SubjectQuizAttempt } from "@/lib/types";
import { ArrowIcon, BookIcon, CalendarIcon, CheckIcon, ClipboardIcon } from "./icons";
import { LiveClassCard } from "./live-class-card";
import { NudgeCard } from "./nudge-card";

const quickActions = [
  { href: "/study-workspace", title: "Study with CLARA", note: "AI workspace", icon: BookIcon, tone: "violet" },
  { href: "/timetable", title: "View Timetable", note: "Plan your week", icon: CalendarIcon, tone: "cyan" },
  { href: "/assignments", title: "Add Assignment", note: "Track a deadline", icon: ClipboardIcon, tone: "amber" },
  { href: "/attendance", title: "Check Attendance", note: "Stay above 75%", icon: CheckIcon, tone: "green" },
];

type DashboardQuiz = SubjectQuiz & {
  subjectName: string;
  subjectCode: string;
  attempt?: SubjectQuizAttempt;
};

type DashboardIntegration = {
  loading: boolean;
  quiz?: DashboardQuiz;
  noticeSourceCount: number | null;
  league?: StudyLeaderboardEntry & { rank: number };
};

export function Dashboard() {
  const { profile, user } = useAuth();
  const [now, setNow] = useState<Date>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [integration, setIntegration] = useState<DashboardIntegration>({ loading: true, noticeSourceCount: null });
  const userId = user?.id;

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

  useEffect(() => {
    let active = true;
    async function loadIntegration() {
      if (!supabase || !userId) {
        if (active) setIntegration({ loading: false, noticeSourceCount: null });
        return;
      }

      const [membershipResult, noticeResult, leagueResult] = await Promise.all([
        supabase.from("subject_memberships").select("subject_id"),
        supabase.from("college_notice_sources").select("id", { count: "exact", head: true }).eq("status", "ready"),
        supabase.rpc("get_study_leaderboard"),
      ]);

      let quiz: DashboardQuiz | undefined;
      const subjectIds = (membershipResult.data ?? []).map((membership) => String(membership.subject_id));
      if (!membershipResult.error && subjectIds.length) {
        const [quizResult, subjectResult] = await Promise.all([
          supabase.from("subject_quizzes").select("*").in("subject_id", subjectIds).eq("status", "published").order("created_at", { ascending: false }),
          supabase.from("subjects").select("*").in("id", subjectIds),
        ]);
        const quizRows = (quizResult.data ?? []) as SubjectQuiz[];
        const subjects = (subjectResult.data ?? []) as OfficialSubject[];
        const attemptResult = quizRows.length
          ? await supabase.from("subject_quiz_attempts").select("*").eq("student_id", userId).in("quiz_id", quizRows.map((row) => row.id))
          : { data: [], error: null };
        if (!quizResult.error && !subjectResult.error && !attemptResult.error) {
          const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
          const attemptByQuiz = new Map(((attemptResult.data ?? []) as SubjectQuizAttempt[]).map((attempt) => [attempt.quiz_id, attempt]));
          const candidates = quizRows.map((row) => {
            const subject = subjectById.get(row.subject_id);
            return { ...row, subjectName: subject?.name ?? "Official Subject", subjectCode: subject?.code ?? "OFFICIAL", attempt: attemptByQuiz.get(row.id) };
          });
          const available = candidates.find((row) => !row.attempt && (!row.due_at || new Date(row.due_at).getTime() > Date.now()));
          quiz = available ?? candidates.find((row) => Boolean(row.attempt));
        }
      }

      const leagueRows = leagueResult.error ? [] : (leagueResult.data ?? []) as StudyLeaderboardEntry[];
      const leagueIndex = leagueRows.findIndex((entry) => entry.user_id === userId);
      const ownLeague = leagueIndex >= 0 ? leagueRows[leagueIndex] : undefined;
      if (active) {
        setIntegration({
          loading: false,
          quiz,
          noticeSourceCount: noticeResult.error ? null : noticeResult.count ?? 0,
          league: ownLeague && (ownLeague.active_days > 0 || ownLeague.total_sessions_last_7 > 0)
            ? { ...ownLeague, rank: leagueIndex + 1 }
            : undefined,
        });
      }
    }
    void loadIntegration();
    return () => { active = false; };
  }, [userId]);

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
        <div><p className="eyebrow">YOUR ACADEMIC COMMAND CENTER</p><h1>{greeting}, {profile?.full_name?.split(" ")[0] || "Student"} <span>👋</span></h1><p>Here&apos;s what your academic day looks like.</p></div>
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

      <section className="dashboard-integration-section">
        <div className="section-heading"><div><p className="eyebrow">CLARA AT A GLANCE</p><h2>Your learning command center</h2></div></div>
        <div className="dashboard-integration-grid">
          <article className="dashboard-integration-card quiz-summary-card">
            <p>OFFICIAL QUIZ</p>
            {integration.loading ? <div className="integration-loading">Loading…</div> : integration.quiz ? <>
              <span>{integration.quiz.subjectCode} · {integration.quiz.subjectName}</span>
              <h3>{integration.quiz.title}</h3>
              <small>{integration.quiz.difficulty} · {integration.quiz.question_count} Questions</small>
              {integration.quiz.attempt && <strong>Completed · {integration.quiz.attempt.percentage}%</strong>}
              <Link href={`/quiz/${integration.quiz.id}`}>{integration.quiz.attempt ? "Review" : "Attempt Quiz"}<ArrowIcon /></Link>
            </> : <><h3>No official quizzes pending.</h3><span>Your teacher’s published quizzes will appear here.</span><Link href="/quiz">Practice Quiz<ArrowIcon /></Link></>}
          </article>

          <article className="dashboard-integration-card notice-summary-card">
            <p>COLLEGE NOTICES</p>
            {integration.loading ? <div className="integration-loading">Loading…</div> : <>
              <h3>{integration.noticeSourceCount === null ? "Official notice status is unavailable." : integration.noticeSourceCount === 0 ? "No official notices have been uploaded yet." : "Official college information is available."}</h3>
              <span>{integration.noticeSourceCount === null ? "Open the agent to try again" : `${integration.noticeSourceCount} official source${integration.noticeSourceCount === 1 ? "" : "s"}`}</span>
            </>}
            <Link href="/notices">Open Notice Agent<ArrowIcon /></Link>
          </article>

          <article className="dashboard-integration-card consistency-summary-card">
            <p>LEARNING CONSISTENCY</p>
            {integration.loading ? <div className="integration-loading">Loading…</div> : integration.league ? <div className="consistency-summary-values">
              <div><span>Learning Score</span><strong>{integration.league.learning_score}</strong></div>
              <div><span>Current Streak</span><strong>{integration.league.current_streak} <small>days</small></strong></div>
              <div><span>Global Rank</span><strong>#{integration.league.rank}</strong></div>
            </div> : <h3>Start learning in Study Workspace to build your Learning Score.</h3>}
            <Link href="/leaderboard">View Leaderboard<ArrowIcon /></Link>
          </article>
        </div>
      </section>

      <section className="quick-section">
        <div className="section-heading"><div><p className="eyebrow">ONE CLICK AWAY</p><h2>Quick actions</h2></div></div>
        <div className="quick-grid">
          {quickActions.map(({ href, title, note, icon: Icon, tone }) => <Link href={href} className="quick-card" key={href}><span className={`quick-icon ${tone}`}><Icon /></span><div><strong>{title}</strong><span>{note}</span></div><ArrowIcon className="quick-arrow" /></Link>)}
        </div>
      </section>
    </div>
  );
}
