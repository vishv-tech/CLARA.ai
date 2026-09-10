"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStudyMessages,
  getStudyMessages,
  getStudySources,
  saveStudyMessages,
  saveStudySources,
  takeStudyPrefill,
} from "@/lib/study-storage";
import {
  ACCEPTED_FILE_INPUT,
  formatFileSize,
  getSupportedMimeType,
  isStudySourceExpired,
  isYouTubeUrl,
  MAX_STUDY_SOURCES,
  MAX_UPLOAD_BYTES,
} from "@/lib/study-utils";
import type { StudyMessage, StudyMode, StudySource } from "@/lib/types";

const REQUEST_TIMEOUT_MS = 175_000;

const QUICK_ACTIONS = [
  {
    label: "Summarize Sources",
    detail: "Build a focused overview",
    icon: "S",
    prompt: "Summarize the important concepts from my active study sources.",
  },
  {
    label: "Explain Simply",
    detail: "Make the ideas easier",
    icon: "E",
    prompt: "Explain the main concepts from my active study sources in simple student-friendly language.",
  },
  {
    label: "Key Concepts",
    detail: "Find what matters most",
    icon: "K",
    prompt: "Identify the most important concepts I should understand from my active study sources.",
  },
] as const;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceBadge(source: StudySource) {
  if (source.type === "youtube") return "YT";
  if (source.mimeType?.startsWith("image/")) return "IMG";
  if (source.mimeType === "application/pdf") return "PDF";
  if (source.mimeType?.includes("wordprocessingml")) return "DOC";
  if (source.mimeType === "text/markdown") return "MD";
  return "TXT";
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownAnswer({ text }: { text: string }) {
  const sections = text.split(/```(?:[^\n]*)\n?([\s\S]*?)```/g);
  return (
    <div className="study-markdown">
      {sections.map((section, sectionIndex) => {
        if (sectionIndex % 2 === 1) {
          return <pre key={`code-${sectionIndex}`}><code>{section.trim()}</code></pre>;
        }
        return section.split("\n").map((line, lineIndex) => {
          const key = `${sectionIndex}-${lineIndex}-${line.slice(0, 20)}`;
          const heading = line.match(/^(#{1,3})\s+(.+)/);
          const bullet = line.match(/^[-*]\s+(.+)/);
          const numbered = line.match(/^(\d+)\.\s+(.+)/);
          if (!line.trim()) return <span className="study-markdown-gap" key={key} />;
          if (heading) return <h3 key={key}><InlineText text={heading[2]} /></h3>;
          if (bullet) return <div className="study-markdown-list" key={key}><i /> <span><InlineText text={bullet[1]} /></span></div>;
          if (numbered) return <div className="study-markdown-list" key={key}><b>{numbered[1]}.</b> <span><InlineText text={numbered[2]} /></span></div>;
          return <p key={key}><InlineText text={line} /></p>;
        });
      })}
    </div>
  );
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

export function StudyWorkspace({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [sources, setSources] = useState<StudySource[]>([]);
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [mode, setMode] = useState<StudyMode>("course");
  const [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadState, setUploadState] = useState<{ name: string; stage: "Uploading" | "Processing" }>();
  const [showYouTube, setShowYouTube] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedSources = getStudySources();
      let changed = false;
      const currentSources = storedSources.map((source) => {
        const expired = source.status === "ready" && isStudySourceExpired(source);
        if (!expired) return source;
        changed = true;
        return { ...source, status: "needs-reupload" as const };
      });
      if (changed) saveStudySources(currentSources);
      setSources(currentSources);
      setMessages(getStudyMessages());
      const prefill = takeStudyPrefill();
      if (prefill) setInput(prefill);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  const readySources = sources.filter((source) => source.status === "ready");

  function commitSources(next: StudySource[]) {
    setSources(next);
    saveStudySources(next);
  }

  function commitMessages(next: StudyMessage[]) {
    setMessages(next);
    saveStudyMessages(next);
  }

  async function uploadFile(file: File) {
    setError("");
    if (sources.length >= MAX_STUDY_SOURCES) {
      setError(`Your workspace can hold up to ${MAX_STUDY_SOURCES} active sources. Remove one before uploading another.`);
      return;
    }
    const mimeType = getSupportedMimeType(file.name, file.type);
    if (!mimeType) {
      setError("SAGE supports PDF, DOCX, TXT, Markdown, PNG, JPEG, and WEBP files.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`“${file.name}” is ${formatFileSize(file.size)}. Please choose a file under 25 MB.`);
      return;
    }
    if (!configured) {
      setError("SAGE AI is not configured yet. Add GEMINI_API_KEY to .env.local before uploading sources.");
      return;
    }

    setUploadState({ name: file.name, stage: "Uploading" });
    const processingTimer = window.setTimeout(() => setUploadState({ name: file.name, stage: "Processing" }), 650);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/study/upload", { method: "POST", body: formData });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readError(payload, "SAGE could not upload that source. Please try again."));
      if (!payload || typeof payload !== "object" || !("source" in payload)) throw new Error("SAGE received an invalid upload response.");
      const source = payload.source as StudySource;
      commitSources([...sources, source]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "SAGE could not upload that source. Please try again.");
    } finally {
      window.clearTimeout(processingTimer);
      setUploadState(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function addYouTubeSource() {
    const url = youtubeUrl.trim();
    setError("");
    if (sources.length >= MAX_STUDY_SOURCES) {
      setError(`Your workspace can hold up to ${MAX_STUDY_SOURCES} active sources. Remove one first.`);
      return;
    }
    if (!isYouTubeUrl(url)) {
      setError("Paste a valid public youtube.com or youtu.be video URL.");
      return;
    }
    if (sources.some((source) => source.type === "youtube" && source.url === url)) {
      setError("That YouTube lecture is already in your source library.");
      return;
    }
    const source: StudySource = {
      id: createId("youtube"),
      type: "youtube",
      name: "YouTube Lecture",
      url,
      createdAt: new Date().toISOString(),
      status: "ready",
    };
    commitSources([...sources, source]);
    setYoutubeUrl("");
    setShowYouTube(false);
  }

  function removeSource(id: string) {
    commitSources(sources.filter((source) => source.id !== id));
  }

  function markFileSourcesExpired() {
    commitSources(sources.map((source) => source.type === "file" ? { ...source, status: "needs-reupload" } : source));
  }

  async function sendMessage(prompt = input) {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    if (!configured) {
      setError("SAGE AI is not configured yet. Add GEMINI_API_KEY to .env.local to start chatting.");
      return;
    }

    setError("");
    setBusy(true);
    setInput("");
    const userMessage: StudyMessage = {
      id: createId("message"),
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString(),
      mode,
    };
    const nextMessages = [...messages, userMessage];
    commitMessages(nextMessages);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/study/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          mode,
          sources: readySources,
          history: messages.slice(-8),
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        if (payload && typeof payload === "object" && "code" in payload && payload.code === "SOURCE_EXPIRED") {
          markFileSourcesExpired();
        }
        throw new Error(readError(payload, "SAGE could not complete that request. Please try again."));
      }
      if (!payload || typeof payload !== "object" || !("text" in payload) || typeof payload.text !== "string") {
        throw new Error("SAGE received an invalid response. Please try again.");
      }
      const result = payload as {
        text: string;
        contextSources?: string[];
        webSearchUsed?: boolean;
        citations?: StudyMessage["citations"];
      };
      const assistantMessage: StudyMessage = {
        id: createId("message"),
        role: "assistant",
        text: result.text,
        createdAt: new Date().toISOString(),
        mode,
        contextSources: result.contextSources,
        webSearchUsed: result.webSearchUsed,
        citations: result.citations,
      };
      commitMessages([...nextMessages, assistantMessage]);
    } catch (requestError) {
      const message = requestError instanceof DOMException && requestError.name === "AbortError"
        ? "SAGE took too long to respond. Please try again in a moment."
        : requestError instanceof Error
          ? requestError.message
          : "A network problem stopped SAGE from responding. Please try again.";
      setError(message);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  function handleClearChat() {
    setMessages([]);
    clearStudyMessages();
    setError("");
  }

  return (
    <div className="study-page">
      <header className="study-header">
        <div>
          <p className="eyebrow">LEARN WITH YOUR OWN SOURCES</p>
          <h1>SAGE Study Workspace</h1>
          <p>Turn your course material into a focused, context-aware study conversation.</p>
        </div>
        <div className="study-mode-switch" aria-label="Study mode">
          <button className={mode === "course" ? "active" : ""} onClick={() => setMode("course")} type="button">
            <span>Course Mode</span><small>Prioritize my study sources</small>
          </button>
          <button className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")} type="button">
            <span>Explore Mode</span><small>Use current web information</small>
          </button>
        </div>
      </header>

      {!configured && (
        <div className="study-config-banner" role="status">
          <span>!</span>
          <div><strong>SAGE AI is not configured yet</strong><p>Add <code>GEMINI_API_KEY</code> to <code>.env.local</code>, then restart the development server.</p></div>
        </div>
      )}

      <div className="study-workspace-grid">
        <aside className="study-sources-panel">
          <div className="study-panel-heading">
            <div><p>KNOWLEDGE LIBRARY</p><h2>Sources</h2></div>
            <span>{sources.length}/{MAX_STUDY_SOURCES}</span>
          </div>
          <p className="study-panel-note">Files stay available in Gemini temporarily. Re-upload expired material when prompted.</p>

          <div className="study-source-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_INPUT}
              aria-label="Upload a study file"
              disabled={Boolean(uploadState)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploadState) || sources.length >= MAX_STUDY_SOURCES}>
              <b>+</b> Upload File
            </button>
            <button type="button" onClick={() => setShowYouTube((current) => !current)} disabled={Boolean(uploadState) || sources.length >= MAX_STUDY_SOURCES}>
              <b>+</b> Add YouTube
            </button>
          </div>

          {showYouTube && (
            <div className="study-youtube-form">
              <label htmlFor="youtube-url">Public YouTube URL</label>
              <input
                id="youtube-url"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addYouTubeSource();
                  if (event.key === "Escape") setShowYouTube(false);
                }}
                placeholder="https://youtu.be/..."
                autoFocus
              />
              <div><button type="button" onClick={() => setShowYouTube(false)}>Cancel</button><button type="button" onClick={addYouTubeSource}>Add lecture</button></div>
            </div>
          )}

          <div className="study-source-list" aria-live="polite">
            {uploadState && (
              <article className="study-source-card processing">
                <span className="study-source-badge">...</span>
                <div><strong>{uploadState.name}</strong><span><i /> {uploadState.stage}...</span></div>
              </article>
            )}
            {hydrated && sources.length === 0 && !uploadState && (
              <div className="study-empty-sources"><span>+</span><strong>Bring your material into SAGE</strong><p>PDFs, notes, answer images, or a public YouTube lecture.</p></div>
            )}
            {sources.map((source) => (
              <article className={`study-source-card ${source.status}`} key={source.id}>
                <span className="study-source-badge">{sourceBadge(source)}</span>
                <div title={source.name}>
                  <strong>{source.name}</strong>
                  <span><i /> {source.status === "ready" ? "Ready" : "Needs re-upload"}</span>
                </div>
                <button type="button" onClick={() => removeSource(source.id)} aria-label={`Remove ${source.name}`}>×</button>
              </article>
            ))}
          </div>

          <div className="study-source-footer"><span>Supported</span><p>PDF · DOCX · TXT · MD · PNG · JPEG · WEBP</p><small>Maximum 25 MB per file</small></div>
        </aside>

        <section className="study-chat-panel">
          <div className="study-chat-topbar">
            <div className="study-sage-avatar">S</div>
            <div><h2>Ask SAGE</h2><p>{mode === "course" ? "Grounded in your active study sources" : "Exploring current information with web search"}</p></div>
            <button type="button" onClick={handleClearChat} disabled={messages.length === 0 || busy}>Clear Chat</button>
          </div>

          <div className="study-messages" aria-live="polite">
            {hydrated && messages.length === 0 && (
              <div className="study-welcome">
                <div className="study-welcome-mark">S</div>
                <p className="eyebrow">YOUR ACADEMIC THINKING PARTNER</p>
                <h2>What are we learning today?</h2>
                <p>{mode === "course" ? "Add course material, then ask SAGE to explain, connect, or summarize it." : "Ask a current academic question and SAGE can search the web when useful."}</p>
                {mode === "course" && readySources.length === 0 && <span className="study-source-hint">No active course source yet — general academic questions still work.</span>}
              </div>
            )}

            {messages.map((message) => (
              <article className={`study-message ${message.role}`} key={message.id}>
                <div className="study-message-label"><span>{message.role === "assistant" ? "S" : "You"}</span><strong>{message.role === "assistant" ? "SAGE" : "You"}</strong><small>{message.mode === "course" ? "Course" : "Explore"}</small></div>
                <div className="study-message-body">
                  {message.role === "assistant" ? <MarkdownAnswer text={message.text} /> : <p>{message.text}</p>}
                  {message.contextSources && message.contextSources.length > 0 && (
                    <div className="study-context"><span>Context Sources</span><div>{message.contextSources.map((source) => <b key={source}>{source}</b>)}</div></div>
                  )}
                  {message.webSearchUsed && (
                    <div className="study-web-context"><span>Web search used</span>{message.citations && message.citations.length > 0 && <div>{message.citations.map((citation) => <a href={citation.url} target="_blank" rel="noreferrer" key={citation.url}>{citation.title}</a>)}</div>}</div>
                  )}
                </div>
              </article>
            ))}

            {busy && (
              <article className="study-message assistant thinking">
                <div className="study-message-label"><span>S</span><strong>SAGE</strong></div>
                <div className="study-message-body"><p><i /><i /><i /> SAGE is thinking...</p></div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="study-composer-wrap">
            {error && <div className="study-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
            <div className="study-quick-actions">
              {QUICK_ACTIONS.map((action) => {
                const disabled = busy || mode !== "course" || readySources.length === 0;
                return <button type="button" key={action.label} disabled={disabled} title={disabled ? "Add an active source in Course Mode first" : action.detail} onClick={() => void sendMessage(action.prompt)}><span>{action.icon}</span><div><strong>{action.label}</strong><small>{action.detail}</small></div></button>;
              })}
              <button className="quiz-soon" type="button" disabled={busy} onClick={() => router.push("/quiz")}><span>Q</span><div><strong>Generate Quiz</strong><small>Test active sources</small></div></button>
            </div>
            <div className="study-composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={mode === "course" ? "Ask about your course material..." : "Explore an academic question..."}
                maxLength={4_000}
                rows={2}
                disabled={busy}
              />
              <div><span>Enter to send · Shift + Enter for a new line</span><button type="button" onClick={() => void sendMessage()} disabled={busy || !input.trim()}>{busy ? "Thinking" : "Send"}<b>↗</b></button></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
