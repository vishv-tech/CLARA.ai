"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { OfficialSubject, SubjectSource } from "@/lib/types";

function apiError(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "CLARA could not upload that material.";
}

export function TeacherSubjectPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState<OfficialSubject | null>(null);
  const [sources, setSources] = useState<SubjectSource[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState("");
  const [stage, setStage] = useState<"Uploading" | "Processing">("Uploading");
  const [error, setError] = useState("");

  const loadSubject = useCallback(async () => {
    if (!supabase || !id) return;
    const [subjectResult, sourceResult, membershipResult] = await Promise.all([
      supabase.from("subjects").select("*").eq("id", id).maybeSingle(),
      supabase.from("subject_sources").select("*").eq("subject_id", id).order("created_at", { ascending: false }),
      supabase.from("subject_memberships").select("id", { count: "exact", head: true }).eq("subject_id", id),
    ]);
    setSubject(subjectResult.data as OfficialSubject | null);
    setSources((sourceResult.data ?? []) as SubjectSource[]);
    setStudentCount(membershipResult.count ?? 0);
    if (subjectResult.error) setError("Subject not found, or you are not its teacher.");
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSubject(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSubject]);

  async function upload(file: File) {
    if (!session) return;
    setError("");
    setUploading(file.name);
    setStage("Uploading");
    const timer = window.setTimeout(() => setStage("Processing"), 700);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/subjects/${id}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiError(payload));
      await loadSubject();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "CLARA could not upload that material.");
    } finally {
      window.clearTimeout(timer);
      setUploading("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (loading) return <div className="official-page"><div className="official-empty">Opening official subject…</div></div>;
  if (!subject) return <div className="official-page"><div className="official-alert">Subject not found, or you are not its teacher.</div><Link href="/teacher">← Back to dashboard</Link></div>;

  return <div className="official-page teacher-subject-page">
    <Link className="official-back" href="/teacher">← Teacher Dashboard</Link>
    <header className="official-hero compact">
      <div><p className="eyebrow">{subject.code} · OFFICIAL SUBJECT</p><h1>{subject.name}</h1><p>{subject.description || "Teacher-managed verified course material"}</p></div>
      <button className="official-primary" type="button" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>{uploading ? `${stage}…` : "Upload Material"}</button>
      <input ref={fileInput} hidden type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </header>
    {error && <div className="official-alert" role="alert">{error}</div>}
    <div className="official-metrics">
      <article><span>Join Code</span><strong>{subject.join_code}</strong><p>Share this with enrolled students.</p></article>
      <article><span>Students</span><strong>{studentCount}</strong><p>Joined through the subject code.</p></article>
      <article><span>Official Sources</span><strong>{sources.filter((source) => source.status === "ready").length}</strong><p>Isolated in this subject’s store.</p></article>
    </div>
    <section className="official-section">
      <div className="official-section-heading"><div><p>TEACHER MANAGED</p><h2>Official sources</h2></div><span>{sources.length}</span></div>
      {uploading && <article className="official-source-row processing"><div className="official-file-icon">…</div><div><strong>{uploading}</strong><span>{stage} in this subject’s isolated store…</span></div><b>{stage}</b></article>}
      {sources.length === 0 && !uploading ? <div className="official-empty"><strong>No official sources yet</strong><p>Upload a PDF, DOCX, TXT, or Markdown document under 25 MB.</p></div> : <div className="official-source-list">
        {sources.map((source) => <article className="official-source-row" key={source.id}><div className="official-file-icon">{source.mime_type === "application/pdf" ? "PDF" : source.mime_type.includes("wordprocessing") ? "DOC" : source.mime_type === "text/markdown" ? "MD" : "TXT"}</div><div><strong>{source.name}</strong><span>Added {new Date(source.created_at).toLocaleDateString()}</span></div><b className={source.status}>{source.status}</b></article>)}
      </div>}
    </section>
  </div>;
}
