"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { OfficialSubject, SubjectChatMessage } from "@/lib/types";

type SubjectView = OfficialSubject & { teacherName: string; sourceCount: number };

function createMessageId() {
  return `subject-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readError(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "CLARA couldn't reach the AI service right now.";
}

export function SubjectAgentPage() {
  const { id } = useParams<{ id: string }>();
  const { session, user } = useAuth();
  const [subject, setSubject] = useState<SubjectView | null>(null);
  const [messages, setMessages] = useState<SubjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [askingTeacher, setAskingTeacher] = useState(false);
  const [teacherMessage, setTeacherMessage] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);
  const storageKey = `clara.subject.chat.${id}`;

  const loadSubject = useCallback(async () => {
    if (!supabase || !id) return;
    const subjectResult = await supabase.from("subjects").select("*").eq("id", id).maybeSingle();
    if (subjectResult.error || !subjectResult.data) {
      setError("Subject not found, or you are not enrolled.");
      setLoading(false);
      return;
    }
    const row = subjectResult.data as OfficialSubject;
    const [teacher, sources] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", row.teacher_id).maybeSingle(),
      supabase.from("subject_sources").select("id", { count: "exact", head: true }).eq("subject_id", id).eq("status", "ready"),
    ]);
    setSubject({
      ...row,
      teacherName: String(teacher.data?.full_name || "your teacher"),
      sourceCount: sources.count ?? 0,
    });
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSubject();
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setMessages(parsed.filter((message): message is SubjectChatMessage => (
              message !== null
              && typeof message === "object"
              && "id" in message
              && typeof message.id === "string"
              && "role" in message
              && (message.role === "user" || message.role === "assistant")
              && "text" in message
              && typeof message.text === "string"
              && "createdAt" in message
              && typeof message.createdAt === "string"
            )).slice(-40));
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSubject, storageKey]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  function commitMessages(next: SubjectChatMessage[]) {
    setMessages(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next.slice(-40)));
    } catch {
      // The active chat still works if browser storage is unavailable or full.
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || !session || busy) return;
    setError("");
    setTeacherMessage("");
    setPendingQuestion("");
    setBusy(true);
    setInput("");
    const userMessage: SubjectChatMessage = {
      id: createMessageId(),
      role: "user",
      text: question,
      createdAt: new Date().toISOString(),
    };
    const withQuestion = [...messages, userMessage];
    commitMessages(withQuestion);
    try {
      const response = await fetch(`/api/subjects/${id}/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-8).map(({ role, text }) => ({ role, text })),
        }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readError(payload));
      if (!payload || typeof payload !== "object" || !("answer" in payload) || typeof payload.answer !== "string") {
        throw new Error("CLARA returned an invalid official answer.");
      }
      const result = payload as { answer: string; answerableFromOfficialSources?: boolean; sources?: string[] };
      const assistantMessage: SubjectChatMessage = {
        id: createMessageId(),
        role: "assistant",
        text: result.answer,
        createdAt: new Date().toISOString(),
        answerableFromOfficialSources: result.answerableFromOfficialSources === true,
        sources: result.sources ?? [],
      };
      commitMessages([...withQuestion, assistantMessage]);
      if (!assistantMessage.answerableFromOfficialSources) setPendingQuestion(question);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "CLARA couldn't reach the AI service right now.");
    } finally {
      setBusy(false);
    }
  }

  async function askTeacher() {
    if (!supabase || !user || !pendingQuestion || askingTeacher || !subject) return;
    setAskingTeacher(true);
    setError("");
    const { error: questionError } = await supabase.from("subject_questions").insert({
      subject_id: subject.id,
      student_id: user.id,
      question: pendingQuestion,
      status: "pending",
    });
    setAskingTeacher(false);
    if (questionError && questionError.code !== "23505") {
      setError("CLARA couldn't reach the AI service right now.");
      return;
    }
    setTeacherMessage(`Question sent to ${subject.teacherName}.`);
    setPendingQuestion("");
  }

  if (loading) return <div className="official-page"><div className="official-empty">Opening Official Subject Agent…</div></div>;
  if (!subject) return <div className="official-page"><div className="official-alert">{error || "Subject not found."}</div><Link href="/subjects">← Back to My Subjects</Link></div>;

  return <div className="official-page subject-agent-page">
    <Link className="official-back" href="/subjects">← My Subjects</Link>
    <header className="subject-agent-header">
      <div className="official-card-badge">{subject.code}</div>
      <div><p className="eyebrow">{subject.name.toUpperCase()}</p><h1>Official Subject Agent</h1><p><span>✓ Teacher Verified Knowledge</span> Maintained by {subject.teacherName} · {subject.sourceCount} official sources</p></div>
    </header>
    {error && <div className="official-alert" role="alert">{error}</div>}
    <div className="subject-agent-chat">
      <div className="subject-agent-notice"><span>✓</span><p><strong>Official-only answers</strong> CLARA searches only this subject’s teacher-managed store. It will ask your teacher instead of guessing.</p></div>
      <div className="subject-agent-messages" aria-live="polite">
        {messages.length === 0 && <div className="subject-agent-empty"><span>{subject.code}</span><h2>Ask from official material</h2><p>Try “Explain the main ideas from our latest notes.”</p></div>}
        {messages.map((message) => <article className={`subject-message ${message.role}`} key={message.id}>
          <div>{message.role === "user" ? "You" : "C"}</div>
          <section>
            <strong>{message.role === "user" ? "You" : "CLARA · Official"}</strong>
            <p>{message.text}</p>
            {message.sources && message.sources.length > 0 && <aside><span>Sources</span>{message.sources.map((source) => <b key={source}>{source}</b>)}</aside>}
          </section>
        </article>)}
        {busy && <article className="subject-message assistant"><div>C</div><section><strong>CLARA · Searching official sources</strong><p className="official-thinking">Checking this subject’s isolated store…</p></section></article>}
        <div ref={messagesEnd} />
      </div>
      {pendingQuestion && <aside className="ask-teacher-card"><div><span>?</span><p><strong>I couldn’t verify that from official material.</strong> I won’t guess. Send the original question to {subject.teacherName}.</p></div><button type="button" disabled={askingTeacher} onClick={() => void askTeacher()}>{askingTeacher ? "Sending…" : `Ask ${subject.teacherName}`}</button></aside>}
      {teacherMessage && <div className="official-alert success" role="status">{teacherMessage}</div>}
      <form className="subject-agent-composer" onSubmit={sendMessage}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={4000} placeholder={subject.sourceCount ? `Ask about ${subject.name} official material…` : "Your teacher has not uploaded official material yet."} disabled={busy} />
        <button className="official-primary" disabled={busy || !input.trim()}>{busy ? "Searching…" : "Ask Official Agent"}</button>
      </form>
    </div>
  </div>;
}
