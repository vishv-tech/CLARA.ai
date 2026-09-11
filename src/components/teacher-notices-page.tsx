"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { CollegeNoticeSource } from "@/lib/types";

function readError(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "CLARA could not upload that official notice.";
}

export function TeacherNoticesPage() {
  const { session } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<CollegeNoticeSource[]>([]);
  const [storeReady, setStoreReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState("");
  const [stage, setStage] = useState<"Uploading" | "Processing">("Uploading");
  const [error, setError] = useState("");

  const loadNotices = useCallback(async () => {
    if (!supabase) return;
    const [settingsResult, sourceResult] = await Promise.all([
      supabase.from("college_notice_settings").select("file_search_store_name").eq("id", 1).maybeSingle(),
      supabase.from("college_notice_sources").select("*").order("created_at", { ascending: false }),
    ]);
    setStoreReady(Boolean(settingsResult.data?.file_search_store_name));
    setSources((sourceResult.data ?? []) as CollegeNoticeSource[]);
    if (settingsResult.error || sourceResult.error) setError("CLARA could not load official college notices.");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotices(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotices]);

  async function upload(file: File) {
    if (!session) return;
    setError("");
    setUploading(file.name);
    setStage("Uploading");
    const timer = window.setTimeout(() => setStage("Processing"), 700);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/notices/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readError(payload));
      await loadNotices();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "CLARA could not upload that official notice.");
    } finally {
      window.clearTimeout(timer);
      setUploading("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const readyCount = sources.filter((source) => source.status === "ready").length;
  return <div className="official-page teacher-notices-page">
    <Link className="official-back" href="/teacher">← Teacher Dashboard</Link>
    <header className="official-hero compact notice-hero">
      <div><p className="eyebrow">COLLEGE-WIDE OFFICIAL KNOWLEDGE</p><h1>College Notice Agent</h1><p>Upload notices once for every student. All files stay in one persistent, isolated notice store.</p></div>
      <button className="official-primary" type="button" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>{uploading ? `${stage}…` : "+ Upload Notice"}</button>
      <input ref={fileInput} hidden type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </header>
    {error && <div className="official-alert" role="alert">{error}</div>}
    <div className="official-metrics notice-metrics">
      <article><span>Notice Store</span><strong>{storeReady ? "Ready" : "On first upload"}</strong><p>One store shared across official college notices.</p></article>
      <article><span>Ready Notices</span><strong>{readyCount}</strong><p>Available to the student notice agent.</p></article>
      <article><span>Isolation</span><strong>Official only</strong><p>No subject, personal, general, or web sources.</p></article>
    </div>
    <section className="official-section">
      <div className="official-section-heading"><div><p>TEACHER MANAGED</p><h2>Official notice sources</h2></div><span>{sources.length}</span></div>
      {uploading && <article className="official-source-row processing"><div className="official-file-icon">…</div><div><strong>{uploading}</strong><span>{stage} in the college notice store…</span></div><b>{stage}</b></article>}
      {loading ? <div className="official-empty">Loading official notices…</div> : sources.length === 0 && !uploading ? <div className="official-empty"><strong>No official notices have been uploaded yet.</strong><p>Upload a PDF, DOCX, TXT, or Markdown notice under 25 MB.</p></div> : <div className="official-source-list">
        {sources.map((source) => <article className="official-source-row" key={source.id}><div className="official-file-icon">{source.mime_type === "application/pdf" ? "PDF" : source.mime_type.includes("wordprocessing") ? "DOC" : source.mime_type === "text/markdown" ? "MD" : "TXT"}</div><div><strong>{source.name}</strong><span>Added {new Date(source.created_at).toLocaleDateString()}</span></div><b className={source.status}>{source.status}</b></article>)}
      </div>}
    </section>
  </div>;
}
