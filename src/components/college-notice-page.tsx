"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import type { NoticeChatMessage } from "@/lib/types";

const STORAGE_KEY = "clara.notice.chat.v1";

function createMessageId() {
  return `notice-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readError(payload: unknown) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "CLARA couldn't search the official notices right now.";
}

export function CollegeNoticePage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<NoticeChatMessage[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (supabase) {
        void supabase.from("college_notice_sources").select("id", { count: "exact", head: true }).eq("status", "ready")
          .then(({ count }) => setSourceCount(count ?? 0));
      }
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed.filter((message): message is NoticeChatMessage => (
            message !== null
            && typeof message === "object"
            && "id" in message && typeof message.id === "string"
            && "role" in message && (message.role === "user" || message.role === "assistant")
            && "text" in message && typeof message.text === "string"
            && "createdAt" in message && typeof message.createdAt === "string"
          )).slice(-40));
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  function commitMessages(next: NoticeChatMessage[]) {
    setMessages(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-40)));
    } catch {
      // The chat remains usable if local storage is unavailable.
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || !session || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    const userMessage: NoticeChatMessage = { id: createMessageId(), role: "user", text: question, createdAt: new Date().toISOString() };
    const withQuestion = [...messages, userMessage];
    commitMessages(withQuestion);
    try {
      const response = await fetch("/api/notices/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: messages.slice(-8).map(({ role, text }) => ({ role, text })) }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readError(payload));
      if (!payload || typeof payload !== "object" || !("answer" in payload) || typeof payload.answer !== "string") {
        throw new Error("CLARA returned an invalid official notice answer.");
      }
      const result = payload as { answer: string; answerableFromOfficialSources?: boolean; sources?: string[] };
      commitMessages([...withQuestion, {
        id: createMessageId(), role: "assistant", text: result.answer, createdAt: new Date().toISOString(),
        answerableFromOfficialSources: result.answerableFromOfficialSources === true, sources: result.sources ?? [],
      }]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "CLARA couldn't search the official notices right now.");
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError("");
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return <div className="official-page notice-agent-page">
    <header className="subject-agent-header notice-agent-header">
      <div className="official-card-badge">N</div>
      <div><p className="eyebrow">COLLEGE-WIDE INFORMATION</p><h1>College Notice Agent</h1><p><span>✓ Official college notices only</span> {sourceCount} verified source{sourceCount === 1 ? "" : "s"}</p></div>
      <button type="button" className="notice-clear" onClick={clearChat} disabled={!messages.length || busy}>Clear chat</button>
    </header>
    {error && <div className="official-alert" role="alert">{error}</div>}
    <div className="subject-agent-chat">
      <div className="subject-agent-notice"><span>✓</span><p><strong>Strict notice isolation</strong> CLARA searches only the teacher-managed college notice store. It will say when official notices do not contain the answer.</p></div>
      <div className="subject-agent-messages" aria-live="polite">
        {messages.length === 0 && <div className="subject-agent-empty"><span>N</span><h2>Ask an official notice question</h2><p>Try “When is the next form submission deadline?”</p></div>}
        {messages.map((message) => <article className={`subject-message ${message.role}`} key={message.id}>
          <div>{message.role === "user" ? "You" : "C"}</div>
          <section><strong>{message.role === "user" ? "You" : "CLARA · Official Notices"}</strong><p>{message.text}</p>{message.sources && message.sources.length > 0 && <aside><span>Notices</span>{message.sources.map((source) => <b key={source}>{source}</b>)}</aside>}</section>
        </article>)}
        {busy && <article className="subject-message assistant"><div>C</div><section><strong>CLARA · Searching official notices</strong><p className="official-thinking">Checking the isolated college notice store…</p></section></article>}
        <div ref={messagesEnd} />
      </div>
      <form className="subject-agent-composer" onSubmit={sendMessage}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={4000} placeholder={sourceCount ? "Ask about an official college notice…" : "No official notices have been uploaded yet."} disabled={busy} />
        <button className="official-primary" disabled={busy || !input.trim()}>{busy ? "Searching…" : "Ask Notice Agent"}</button>
      </form>
    </div>
  </div>;
}
