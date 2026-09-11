"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OfficialSubject } from "@/lib/types";

type JoinedSubject = OfficialSubject & { teacherName: string; sourceCount: number };

export function SubjectsPage() {
  const [subjects, setSubjects] = useState<JoinedSubject[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSubjects = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    setLoading(true);
    const memberships = await client.from("subject_memberships").select("subject_id");
    if (memberships.error) {
      setError("CLARA could not load your official subjects.");
      setLoading(false);
      return;
    }
    const ids = (memberships.data ?? []).map((row) => String(row.subject_id));
    if (ids.length === 0) {
      setSubjects([]);
      setLoading(false);
      return;
    }
    const subjectResult = await client.from("subjects").select("*").in("id", ids).order("name");
    const rows = (subjectResult.data ?? []) as OfficialSubject[];
    const enriched = await Promise.all(rows.map(async (subject) => {
      const [teacher, sources] = await Promise.all([
        client.from("profiles").select("full_name").eq("id", subject.teacher_id).maybeSingle(),
        client.from("subject_sources").select("id", { count: "exact", head: true }).eq("subject_id", subject.id).eq("status", "ready"),
      ]);
      return {
        ...subject,
        teacherName: String(teacher.data?.full_name || "Your teacher"),
        sourceCount: sources.count ?? 0,
      };
    }));
    setSubjects(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSubjects(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSubjects]);

  async function joinSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || joining) return;
    setError("");
    setMessage("");
    setJoining(true);
    const { error: joinError } = await supabase.rpc("join_subject", {
      requested_join_code: joinCode.trim().toUpperCase(),
    });
    setJoining(false);
    if (joinError) {
      const missing = joinError.code === "P0002" || joinError.message.toLowerCase().includes("not found");
      setError(missing ? "Subject code not found." : "CLARA could not join that subject. Check the code and try again.");
      return;
    }
    setMessage("Subject joined. Its Official Subject Agent is ready.");
    setJoinCode("");
    setShowJoin(false);
    await loadSubjects();
  }

  return <div className="official-page student-subjects-page">
    <header className="official-hero">
      <div><p className="eyebrow">COLLEGE VERIFIED KNOWLEDGE</p><h1>My Subjects</h1><p>Official spaces use only material approved by your teachers. Your Personal Study Workspace remains separate.</p></div>
      <button className="official-primary" type="button" onClick={() => setShowJoin((value) => !value)}>Join Subject</button>
    </header>
    {showJoin && <form className="official-join-form" onSubmit={joinSubject}>
      <div><strong>Enter your subject join code</strong><span>Ask your teacher for the code shown on their subject page.</span></div>
      <input aria-label="Subject join code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={14} placeholder="AI-AB123" required />
      <button className="official-primary" disabled={joining}>{joining ? "Joining…" : "Join"}</button>
    </form>}
    {error && <div className="official-alert" role="alert">{error}</div>}
    {message && <div className="official-alert success" role="status">{message}</div>}
    <section className="official-section">
      <div className="official-section-heading"><div><p>MY SUBJECTS</p><h2>Teacher verified spaces</h2></div><span>{subjects.length}</span></div>
      {loading ? <div className="official-empty">Loading your subjects…</div> : subjects.length === 0 ? <div className="official-empty"><strong>You have not joined a subject yet</strong><p>Use a teacher’s join code to unlock an isolated Official Subject Agent.</p></div> : <div className="official-card-grid">
        {subjects.map((subject) => <article className="official-subject-card student" key={subject.id}>
          <div className="official-card-badge">{subject.code}</div>
          <span className="official-status">✓ Teacher Verified</span>
          <h3>{subject.name}</h3>
          <p>Maintained by {subject.teacherName}</p>
          <div className="official-card-stats"><span><strong>{subject.sourceCount}</strong> Official Sources</span><span><strong>Isolated</strong> Knowledge</span></div>
          <Link href={`/subjects/${subject.id}`}>Open Subject Agent <span>→</span></Link>
        </article>)}
      </div>}
    </section>
    <aside className="official-personal-note"><span>P</span><div><strong>Looking for your own notes?</strong><p>Your Personal Study Workspace still supports private uploads and broader AI help.</p></div><Link href="/study-workspace">Open personal lab →</Link></aside>
  </div>;
}
