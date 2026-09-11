"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { OfficialSubject, SubjectQuestion } from "@/lib/types";

type SubjectSummary = OfficialSubject & { studentCount: number; sourceCount: number };

function readApiError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function TeacherDashboard() {
  const { profile, session } = useAuth();
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<SubjectQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    const client = supabase;
    if (!client || profile?.role !== "teacher") return;
    setLoading(true);
    const [subjectResult, questionResult] = await Promise.all([
      client.from("subjects").select("*").order("created_at", { ascending: false }),
      client.from("subject_questions").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(4),
    ]);
    if (subjectResult.error) {
      setError("CLARA could not load your subjects.");
      setLoading(false);
      return;
    }
    const rows = (subjectResult.data ?? []) as OfficialSubject[];
    const summaries = await Promise.all(rows.map(async (subject) => {
      const [members, sources] = await Promise.all([
        client.from("subject_memberships").select("id", { count: "exact", head: true }).eq("subject_id", subject.id),
        client.from("subject_sources").select("id", { count: "exact", head: true }).eq("subject_id", subject.id).eq("status", "ready"),
      ]);
      return { ...subject, studentCount: members.count ?? 0, sourceCount: sources.count ?? 0 };
    }));
    setSubjects(summaries);
    setPendingQuestions((questionResult.data ?? []) as SubjectQuestion[]);
    setLoading(false);
  }, [profile?.role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  async function createSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setError("");
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/subjects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.get("name"),
          code: formData.get("code"),
          description: formData.get("description"),
        }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readApiError(payload, "CLARA could not create that subject."));
      event.currentTarget.reset();
      setShowCreate(false);
      await loadDashboard();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "CLARA could not create that subject.");
    } finally {
      setSubmitting(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return <div className="official-page teacher-page">
    <header className="official-hero">
      <div><p className="eyebrow">TEACHER VERIFIED KNOWLEDGE</p><h1>{greeting}, {profile?.full_name || "Professor"}</h1><p>Create focused subject spaces backed only by your official material.</p></div>
      <button className="official-primary" type="button" onClick={() => setShowCreate((value) => !value)}>+ Create Subject</button>
    </header>

    {error && <div className="official-alert" role="alert">{error}</div>}
    {showCreate && <form className="official-create-form" onSubmit={createSubject}>
      <div><p className="eyebrow">NEW OFFICIAL SPACE</p><h2>Create a subject</h2><p>CLARA creates a separate Gemini File Search store for every subject.</p></div>
      <label>Subject Name<input name="name" required maxLength={120} placeholder="Artificial Intelligence" /></label>
      <label>Subject Code<input name="code" required maxLength={8} placeholder="AI" onInput={(event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }} /></label>
      <label className="wide">Description <span>optional</span><textarea name="description" maxLength={500} placeholder="TYBSc IT Artificial Intelligence" /></label>
      <div className="official-form-actions"><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="official-primary" disabled={submitting}>{submitting ? "Creating isolated store…" : "Create Official Subject"}</button></div>
    </form>}

    <section className="official-section">
      <div className="official-section-heading"><div><p>YOUR SUBJECTS</p><h2>Official subject spaces</h2></div><span>{subjects.length}</span></div>
      {loading ? <div className="official-empty">Loading your subjects…</div> : subjects.length === 0 ? <div className="official-empty"><strong>No subjects yet</strong><p>Create your first verified subject space for the demo.</p></div> : <div className="official-card-grid">
        {subjects.map((subject) => <article className="official-subject-card" key={subject.id}>
          <div className="official-card-badge">{subject.code}</div>
          <span className="official-status">✓ Official</span>
          <h3>{subject.name}</h3>
          <p>{subject.description || "Teacher-managed verified course material"}</p>
          <div className="official-card-stats"><span><strong>{subject.studentCount}</strong> Students</span><span><strong>{subject.sourceCount}</strong> Sources</span></div>
          <div className="official-join-code"><span>Join code</span><strong>{subject.join_code}</strong></div>
          <Link href={`/teacher/subjects/${subject.id}`}>Manage <span>→</span></Link>
        </article>)}
      </div>}
    </section>

    <section className="official-section official-pending">
      <div className="official-section-heading"><div><p>ASK TEACHER</p><h2>Pending student questions</h2></div><span>{pendingQuestions.length}</span></div>
      {pendingQuestions.length === 0 ? <div className="official-empty compact">No pending questions yet.</div> : <div className="official-question-list">
        {pendingQuestions.map((question) => <article key={question.id}><span>Pending</span><p>{question.question}</p><time>{new Date(question.created_at).toLocaleDateString()}</time></article>)}
      </div>}
    </section>
  </div>;
}
