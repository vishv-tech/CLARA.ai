"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type {
  OfficialSubject,
  SubjectQuiz,
  SubjectQuizAnswerKey,
  SubjectQuizQuestion,
  SubjectSource,
} from "@/lib/types";

type QuizSummary = SubjectQuiz & { attemptCount: number };
type PreviewQuestion = SubjectQuizQuestion & { correct_index: number; explanation: string };

function apiError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function formatDeadline(value: string | null) {
  if (!value) return "No deadline";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function TeacherSubjectPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState<OfficialSubject | null>(null);
  const [sources, setSources] = useState<SubjectSource[]>([]);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState("");
  const [stage, setStage] = useState<"Uploading" | "Processing">("Uploading");
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewQuiz, setPreviewQuiz] = useState<SubjectQuiz | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<PreviewQuestion[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [quizBusy, setQuizBusy] = useState("");
  const [error, setError] = useState("");

  const loadSubject = useCallback(async () => {
    const client = supabase;
    if (!client || !id) return;
    const [subjectResult, sourceResult, membershipResult, quizResult] = await Promise.all([
      client.from("subjects").select("*").eq("id", id).maybeSingle(),
      client.from("subject_sources").select("*").eq("subject_id", id).order("created_at", { ascending: false }),
      client.from("subject_memberships").select("id", { count: "exact", head: true }).eq("subject_id", id),
      client.from("subject_quizzes").select("*").eq("subject_id", id).order("created_at", { ascending: false }),
    ]);
    setSubject(subjectResult.data as OfficialSubject | null);
    setSources((sourceResult.data ?? []) as SubjectSource[]);
    setStudentCount(membershipResult.count ?? 0);
    const quizRows = (quizResult.data ?? []) as SubjectQuiz[];
    const quizSummaries = await Promise.all(quizRows.map(async (quiz) => {
      const result = await client.from("subject_quiz_attempts").select("id", { count: "exact", head: true }).eq("quiz_id", quiz.id);
      return { ...quiz, attemptCount: result.count ?? 0 };
    }));
    setQuizzes(quizSummaries);
    if (subjectResult.error || quizResult.error) setError("Subject not found, or you are not its teacher.");
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
      if (!response.ok) throw new Error(apiError(payload, "CLARA could not upload that material."));
      await loadSubject();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "CLARA could not upload that material.");
    } finally {
      window.clearTimeout(timer);
      setUploading("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openPreview(quiz: SubjectQuiz) {
    if (!supabase) return;
    setError("");
    setPreviewLoading(true);
    setPreviewQuiz(quiz);
    const questionResult = await supabase.from("subject_quiz_questions").select("*").eq("quiz_id", quiz.id).order("position");
    const questions = (questionResult.data ?? []) as SubjectQuizQuestion[];
    const keyResult = questions.length
      ? await supabase.from("subject_quiz_answer_keys").select("*").in("question_id", questions.map((question) => question.id))
      : { data: [], error: null };
    if (questionResult.error || keyResult.error) {
      setError("CLARA could not load this quiz preview.");
      setPreviewQuestions([]);
    } else {
      const keys = new Map(((keyResult.data ?? []) as SubjectQuizAnswerKey[]).map((key) => [key.question_id, key]));
      setPreviewQuestions(questions.map((question) => ({
        ...question,
        correct_index: keys.get(question.id)?.correct_index ?? -1,
        explanation: keys.get(question.id)?.explanation ?? "Answer explanation unavailable.",
      })));
    }
    setPreviewLoading(false);
  }

  async function generateQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || generating) return;
    setError("");
    setGenerating(true);
    const formData = new FormData(event.currentTarget);
    const dueValue = String(formData.get("dueAt") || "");
    try {
      const response = await fetch(`/api/subjects/${id}/quizzes/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.get("title"),
          difficulty: formData.get("difficulty"),
          questionCount: Number(formData.get("questionCount")),
          dueAt: dueValue ? new Date(dueValue).toISOString() : null,
        }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiError(payload, "CLARA couldn't generate the quiz right now. Please try again."));
      if (!payload || typeof payload !== "object" || !("quiz" in payload) || !("questions" in payload)) {
        throw new Error("CLARA returned an incomplete quiz preview.");
      }
      setPreviewQuiz(payload.quiz as SubjectQuiz);
      setPreviewQuestions(payload.questions as PreviewQuestion[]);
      setShowGenerate(false);
      await loadSubject();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "CLARA couldn't generate the quiz right now. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function publishQuiz(quiz: SubjectQuiz) {
    if (!session || quizBusy) return;
    setQuizBusy(quiz.id);
    setError("");
    try {
      const response = await fetch(`/api/subjects/${id}/quizzes/${quiz.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiError(payload, "CLARA could not publish this quiz."));
      setPreviewQuiz(null);
      setPreviewQuestions([]);
      await loadSubject();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "CLARA could not publish this quiz.");
    } finally {
      setQuizBusy("");
    }
  }

  async function deleteDraft(quiz: SubjectQuiz) {
    if (!session || quizBusy || !window.confirm(`Delete the draft “${quiz.title}”?`)) return;
    setQuizBusy(quiz.id);
    setError("");
    try {
      const response = await fetch(`/api/subjects/${id}/quizzes/${quiz.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(apiError(payload, "CLARA could not delete this draft."));
      setPreviewQuiz(null);
      setPreviewQuestions([]);
      await loadSubject();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "CLARA could not delete this draft.");
    } finally {
      setQuizBusy("");
    }
  }

  if (loading) return <div className="official-page"><div className="official-empty">Opening official subject…</div></div>;
  if (!subject) return <div className="official-page"><div className="official-alert">Subject not found, or you are not its teacher.</div><Link href="/teacher">← Back to dashboard</Link></div>;

  const readySourceCount = sources.filter((source) => source.status === "ready").length;
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
      <article><span>Official Sources</span><strong>{readySourceCount}</strong><p>Isolated in this subject’s store.</p></article>
    </div>
    <section className="official-section">
      <div className="official-section-heading"><div><p>TEACHER MANAGED</p><h2>Official sources</h2></div><span>{sources.length}</span></div>
      {uploading && <article className="official-source-row processing"><div className="official-file-icon">…</div><div><strong>{uploading}</strong><span>{stage} in this subject’s isolated store…</span></div><b>{stage}</b></article>}
      {sources.length === 0 && !uploading ? <div className="official-empty"><strong>No official sources yet</strong><p>Upload a PDF, DOCX, TXT, or Markdown document under 25 MB.</p></div> : <div className="official-source-list">
        {sources.map((source) => <article className="official-source-row" key={source.id}><div className="official-file-icon">{source.mime_type === "application/pdf" ? "PDF" : source.mime_type.includes("wordprocessing") ? "DOC" : source.mime_type === "text/markdown" ? "MD" : "TXT"}</div><div><strong>{source.name}</strong><span>Added {new Date(source.created_at).toLocaleDateString()}</span></div><b className={source.status}>{source.status}</b></article>)}
      </div>}
    </section>

    <section className="official-section teacher-quiz-section">
      <div className="official-section-heading"><div><p>OFFICIAL ASSESSMENTS</p><h2>Official Quizzes</h2></div><button className="official-primary" type="button" onClick={() => setShowGenerate((value) => !value)}>+ Generate Quiz</button></div>
      {showGenerate && <form className="teacher-quiz-form" onSubmit={generateQuiz}>
        <label>Quiz Title<input name="title" required minLength={2} maxLength={160} placeholder="AI Unit 3 Assessment" /></label>
        <label>Difficulty<select name="difficulty" defaultValue="medium"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        <label>Questions<select name="questionCount" defaultValue="5"><option value="5">5 questions</option><option value="10">10 questions</option></select></label>
        <label>Due Date / Time <span>optional</span><input name="dueAt" type="datetime-local" /></label>
        <div><button type="button" onClick={() => setShowGenerate(false)}>Cancel</button><button className="official-primary" disabled={generating || readySourceCount === 0}>{generating ? "Generating from official store…" : "Generate Draft"}</button></div>
        {readySourceCount === 0 && <p>Upload official subject material before generating a quiz.</p>}
      </form>}
      {quizzes.length === 0 ? <div className="official-empty"><strong>No official quizzes yet</strong><p>Generate an assessment from your verified subject material.</p></div> : <div className="teacher-quiz-list">
        {quizzes.map((quiz) => <article className="teacher-quiz-row" key={quiz.id}>
          <div><span className={`teacher-quiz-status ${quiz.status}`}>{quiz.status}</span><strong>{quiz.title}</strong><p>{quiz.difficulty} · {quiz.question_count} questions · {formatDeadline(quiz.due_at)}</p></div>
          <div><b>{quiz.attemptCount}</b><span>Attempt{quiz.attemptCount === 1 ? "" : "s"}</span></div>
          <button type="button" onClick={() => void openPreview(quiz)}>Preview</button>
        </article>)}
      </div>}
    </section>

    {previewQuiz && <section className="official-section teacher-quiz-preview">
      <div className="official-section-heading"><div><p>{previewQuiz.status.toUpperCase()} PREVIEW</p><h2>{previewQuiz.title}</h2></div><button type="button" onClick={() => { setPreviewQuiz(null); setPreviewQuestions([]); }}>Close</button></div>
      <p className="teacher-preview-meta">{previewQuiz.difficulty} · {previewQuiz.question_count} questions · {formatDeadline(previewQuiz.due_at)}</p>
      {previewLoading ? <div className="official-empty compact">Loading protected answer key…</div> : <div className="teacher-preview-list">
        {previewQuestions.map((question) => <article key={question.id}>
          <div><span>{question.position + 1}</span><b>{question.topic}</b></div>
          <h3>{question.question}</h3>
          <ol type="A">{question.options.map((option, index) => <li className={index === question.correct_index ? "correct" : ""} key={`${question.id}-${index}`}>{option}{index === question.correct_index && <strong>Correct</strong>}</li>)}</ol>
          <p><strong>Explanation:</strong> {question.explanation}</p>
        </article>)}
      </div>}
      {previewQuiz.status === "draft" && <div className="teacher-preview-actions"><button type="button" className="teacher-delete-draft" disabled={quizBusy === previewQuiz.id} onClick={() => void deleteDraft(previewQuiz)}>Delete Draft</button><button type="button" className="official-primary" disabled={quizBusy === previewQuiz.id || previewQuestions.length !== previewQuiz.question_count} onClick={() => void publishQuiz(previewQuiz)}>{quizBusy === previewQuiz.id ? "Publishing…" : "Publish Quiz"}</button></div>}
    </section>}
  </div>;
}
