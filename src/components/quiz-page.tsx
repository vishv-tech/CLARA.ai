"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OfficialQuizList } from "@/components/official-quiz-list";
import { getQuizAttempts, saveQuizAttempt, updateQuizRecommendation, updateQuizSyncStatus } from "@/lib/quiz-storage";
import { syncQuizAttempt } from "@/lib/quiz-sync";
import { evaluateQuiz, formatQuizDuration, scoreLabel } from "@/lib/quiz-utils";
import { getStudySources, saveStudyPrefill, saveStudySources } from "@/lib/study-storage";
import { isStudySourceExpired } from "@/lib/study-utils";
import type { GeneratedQuiz, QuizAttempt, QuizDifficulty, StudySource } from "@/lib/types";

type QuizView = "setup" | "taking" | "result" | "review";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;
const REQUEST_TIMEOUT_MS = 175_000;

function friendlyDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

function isGeneratedQuiz(value: unknown): value is GeneratedQuiz {
  if (!value || typeof value !== "object") return false;
  const quiz = value as GeneratedQuiz;
  return typeof quiz.id === "string"
    && typeof quiz.title === "string"
    && Array.isArray(quiz.questions)
    && (quiz.questions.length === 5 || quiz.questions.length === 10)
    && quiz.questions.every((question) => Array.isArray(question.options) && question.options.length === 4);
}

function ResultOverview({
  attempt,
  recommendationLoading,
  onReview,
  onStudy,
  onAgain,
}: {
  attempt: QuizAttempt;
  recommendationLoading: boolean;
  onReview: () => void;
  onStudy: () => void;
  onAgain: () => void;
}) {
  return (
    <section className="quiz-result-panel">
      <div className="quiz-result-hero">
        <span className="quiz-result-icon">✓</span>
        <p className="eyebrow">QUIZ COMPLETE</p>
        <h1>{attempt.correctAnswers} / {attempt.questionCount}</h1>
        <strong>{attempt.percentage}%</strong>
        <h2>{scoreLabel(attempt.percentage)}</h2>
        <p>{attempt.title} · {attempt.difficulty} · {formatQuizDuration(attempt.durationSeconds)}</p>
      </div>

      <div className="quiz-result-stats">
        <div><span>Correct</span><strong>{attempt.correctAnswers}</strong></div>
        <div><span>Incorrect</span><strong>{attempt.incorrectAnswers}</strong></div>
        <div><span>Unanswered</span><strong>{attempt.unanswered}</strong></div>
        <div><span>Duration</span><strong>{formatQuizDuration(attempt.durationSeconds)}</strong></div>
      </div>

      <div className="quiz-topic-grid">
        <article>
          <span className="quiz-topic-symbol strong">✓</span>
          <div><p>STRONG AREAS</p><h3>{attempt.strongTopics.length ? attempt.strongTopics.join(", ") : "Keep building"}</h3></div>
        </article>
        <article>
          <span className="quiz-topic-symbol weak">!</span>
          <div><p>NEEDS IMPROVEMENT</p><h3>{attempt.weakTopics.length ? attempt.weakTopics.join(", ") : attempt.developingTopics.join(", ") || "No major gaps detected"}</h3></div>
        </article>
      </div>

      <div className="quiz-performance-panel">
        <div className="quiz-section-heading"><div><p>DETERMINISTIC ANALYSIS</p><h2>Topic performance</h2></div></div>
        <div className="quiz-performance-list">
          {attempt.topicPerformance.map((topic) => (
            <div key={topic.topic}>
              <span>{topic.topic}<small>{topic.correct}/{topic.total} correct</small></span>
              <div><i style={{ width: `${topic.accuracy}%` }} className={topic.status} /></div>
              <b className={topic.status}>{topic.accuracy}%</b>
            </div>
          ))}
        </div>
      </div>

      <div className="quiz-recommendation">
        <span>S</span>
        <div><p>CLARA RECOMMENDS</p><h3>{recommendationLoading ? "Personalizing your revision plan..." : attempt.recommendation}</h3></div>
      </div>

      <div className="quiz-result-actions">
        <button type="button" className="quiz-primary-button" onClick={onReview}>Review Answers</button>
        <button type="button" className="quiz-secondary-button" onClick={onStudy}>Study Weak Topics</button>
        <button type="button" className="quiz-text-button" onClick={onAgain}>Take Another Quiz</button>
      </div>
    </section>
  );
}

function AnswerReview({ attempt, onBack, onStudy }: { attempt: QuizAttempt; onBack: () => void; onStudy: () => void }) {
  return (
    <section className="quiz-review-page">
      <div className="quiz-review-header">
        <div><p className="eyebrow">LEARN FROM EVERY ANSWER</p><h1>Answer Review</h1><p>{attempt.title} · {attempt.percentage}%</p></div>
        <button type="button" className="quiz-secondary-button" onClick={onBack}>Back to Results</button>
      </div>
      <div className="quiz-review-list">
        {attempt.questions.map((question, index) => {
          const selected = attempt.selectedAnswers[index];
          const correct = selected === question.correctOptionIndex;
          return (
            <article className={`quiz-review-card ${correct ? "correct" : "incorrect"}`} key={question.id}>
              <div className="quiz-review-number"><span>{index + 1}</span><b>{correct ? "Correct" : selected === null ? "Unanswered" : "Incorrect"}</b></div>
              <div className="quiz-review-content">
                <span className="quiz-topic-chip">{question.topic}</span>
                <h2>{question.question}</h2>
                <div className="quiz-review-answers">
                  <div><span>Your answer</span><strong>{selected === null ? "No answer" : `${OPTION_LABELS[selected]} — ${question.options[selected]}`}</strong></div>
                  <div><span>Correct answer</span><strong>{OPTION_LABELS[question.correctOptionIndex]} — {question.options[question.correctOptionIndex]}</strong></div>
                </div>
                <div className="quiz-explanation"><span>WHY THIS IS CORRECT</span><p>{question.explanation}</p></div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="quiz-review-footer"><button type="button" className="quiz-primary-button" onClick={onStudy}>Study Weak Topics</button><button type="button" className="quiz-secondary-button" onClick={onBack}>Back to Results</button></div>
    </section>
  );
}

export function QuizPage({ configured }: { configured: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"official" | "practice">("official");
  const [view, setView] = useState<QuizView>("setup");
  const [sources, setSources] = useState<StudySource[]>([]);
  const [history, setHistory] = useState<QuizAttempt[]>([]);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("medium");
  const [questionCount, setQuestionCount] = useState<5 | 10>(5);
  const [topic, setTopic] = useState("");
  const [quiz, setQuiz] = useState<GeneratedQuiz>();
  const [answers, setAnswers] = useState<Array<number | null>>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [activeAttempt, setActiveAttempt] = useState<QuizAttempt>();
  const [generating, setGenerating] = useState(false);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedSources = getStudySources();
      let changed = false;
      const refreshedSources = storedSources.map((source) => {
        if (source.status !== "ready" || !isStudySourceExpired(source)) return source;
        changed = true;
        return { ...source, status: "needs-reupload" as const };
      });
      if (changed) saveStudySources(refreshedSources);
      setSources(refreshedSources);
      setHistory(getQuizAttempts());
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const readySources = sources.filter((source) => source.status === "ready");
  const expiredSources = sources.filter((source) => source.status === "needs-reupload");
  const canGenerate = configured && !generating && (readySources.length > 0 || topic.trim().length >= 2);

  async function generateNewQuiz() {
    if (!canGenerate) return;
    setError("");
    setGenerating(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/study/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", difficulty, questionCount, sources: readySources, topic: topic.trim() }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(readError(payload, "CLARA couldn't generate the quiz right now. Please try again."));
      const generated = payload && typeof payload === "object" && "quiz" in payload ? payload.quiz : undefined;
      if (!isGeneratedQuiz(generated)) throw new Error("CLARA returned an incomplete quiz. Please try again.");
      setQuiz(generated);
      setAnswers(Array.from({ length: generated.questions.length }, () => null));
      setCurrentQuestion(0);
      setStartedAt(new Date(generated.createdAt).getTime());
      setActiveAttempt(undefined);
      setView("taking");
    } catch (generationError) {
      setError(generationError instanceof DOMException && generationError.name === "AbortError"
        ? "CLARA took too long to prepare the quiz. Please try again."
        : generationError instanceof Error
          ? generationError.message
          : "CLARA couldn't generate the quiz right now. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      setGenerating(false);
    }
  }

  function selectAnswer(optionIndex: number) {
    setAnswers((current) => current.map((answer, index) => index === currentQuestion ? optionIndex : answer));
  }

  function finishQuiz(submitAnyway = false) {
    if (!quiz) return;
    const unanswered = answers.filter((answer) => answer === null).length;
    if (unanswered > 0 && !submitAnyway) {
      setConfirmSubmit(true);
      return;
    }
    setConfirmSubmit(false);
    const attempt = { ...evaluateQuiz(quiz, answers, startedAt), remoteSynced: false };
    setActiveAttempt(attempt);
    setHistory(saveQuizAttempt(attempt));
    setView("result");
    setRecommendationLoading(true);
    void requestRecommendation(attempt);
    if (user) {
      void syncQuizAttempt(attempt, user.id).then((synced) => {
        if (!synced) return;
        setHistory(updateQuizSyncStatus(attempt.id, true));
        setActiveAttempt((current) => current?.id === attempt.id ? { ...current, remoteSynced: true } : current);
      });
    }
  }

  async function requestRecommendation(attempt: QuizAttempt) {
    try {
      const response = await fetch("/api/study/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recommend",
          title: attempt.title,
          difficulty: attempt.difficulty,
          percentage: attempt.percentage,
          weakTopics: attempt.weakTopics,
          developingTopics: attempt.developingTopics,
          strongTopics: attempt.strongTopics,
        }),
      });
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !payload || typeof payload !== "object" || !("text" in payload) || typeof payload.text !== "string") return;
      const recommendation = payload.text;
      setActiveAttempt((current) => current?.id === attempt.id ? { ...current, recommendation } : current);
      setHistory(updateQuizRecommendation(attempt.id, recommendation));
    } catch {
      // The deterministic fallback recommendation is already saved with the attempt.
    } finally {
      setRecommendationLoading(false);
    }
  }

  function studyWeakTopics(attempt: QuizAttempt) {
    const priorities = attempt.weakTopics.length ? attempt.weakTopics : attempt.developingTopics;
    const prompt = priorities.length
      ? `Help me revise these weak topics from my latest ${attempt.difficulty} quiz: ${priorities.join(", ")}. Explain them simply, then give me a short study plan.`
      : `Help me deepen the concepts from my latest quiz, ${attempt.title}. I scored ${attempt.percentage}% and want to prepare for a harder attempt.`;
    saveStudyPrefill(prompt);
    router.push("/study-workspace");
  }

  function resetQuiz() {
    setView("setup");
    setQuiz(undefined);
    setActiveAttempt(undefined);
    setAnswers([]);
    setError("");
    setConfirmSubmit(false);
  }

  function openHistory(attempt: QuizAttempt) {
    setActiveAttempt(attempt);
    setRecommendationLoading(false);
    setView("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (view === "review" && activeAttempt) {
    return <AnswerReview attempt={activeAttempt} onBack={() => setView("result")} onStudy={() => studyWeakTopics(activeAttempt)} />;
  }

  if (view === "result" && activeAttempt) {
    return <div className="quiz-page"><ResultOverview attempt={activeAttempt} recommendationLoading={recommendationLoading} onReview={() => setView("review")} onStudy={() => studyWeakTopics(activeAttempt)} onAgain={resetQuiz} /></div>;
  }

  if (view === "taking" && quiz) {
    const question = quiz.questions[currentQuestion];
    const answeredCount = answers.filter((answer) => answer !== null).length;
    const unansweredCount = quiz.questions.length - answeredCount;
    return (
      <div className="quiz-page quiz-taking-page">
        <header className="quiz-taking-header">
          <div><p className="eyebrow">CLARA QUIZ</p><h1>{quiz.title}</h1><p><span>{quiz.difficulty}</span>{quiz.sourceNames.length ? `Based on ${quiz.sourceNames.join(", ")}` : "General academic quiz"}</p></div>
          <button type="button" onClick={resetQuiz}>Exit Quiz</button>
        </header>
        <div className="quiz-progress-row"><span>Question {currentQuestion + 1} of {quiz.questions.length}</span><div><i style={{ width: `${((currentQuestion + 1) / quiz.questions.length) * 100}%` }} /></div><b>{answeredCount}/{quiz.questions.length} answered</b></div>

        <main className="quiz-question-card">
          <div className="quiz-question-meta"><span>QUESTION {currentQuestion + 1}</span><b>{question.topic}</b></div>
          <h2>{question.question}</h2>
          <div className="quiz-options" role="radiogroup" aria-label={`Answers for question ${currentQuestion + 1}`}>
            {question.options.map((option, index) => (
              <button
                type="button"
                role="radio"
                aria-checked={answers[currentQuestion] === index}
                className={answers[currentQuestion] === index ? "selected" : ""}
                onClick={() => selectAnswer(index)}
                key={`${question.id}-${OPTION_LABELS[index]}`}
              >
                <span>{OPTION_LABELS[index]}</span><p>{option}</p><i />
              </button>
            ))}
          </div>
          <div className="quiz-navigation">
            <button type="button" className="quiz-secondary-button" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((current) => current - 1)}>Previous</button>
            {currentQuestion < quiz.questions.length - 1
              ? <button type="button" className="quiz-primary-button" onClick={() => setCurrentQuestion((current) => current + 1)}>Next Question</button>
              : <button type="button" className="quiz-primary-button submit" onClick={() => finishQuiz()}>Submit Quiz</button>}
          </div>

          {confirmSubmit && (
            <div className="quiz-submit-confirm" role="dialog" aria-modal="true" aria-label="Confirm quiz submission">
              <div><span>!</span><h3>You still have {unansweredCount} unanswered question{unansweredCount === 1 ? "" : "s"}.</h3><p>You can return to complete them or submit the quiz as it is.</p><div><button type="button" className="quiz-secondary-button" onClick={() => setConfirmSubmit(false)}>Go Back</button><button type="button" className="quiz-primary-button" onClick={() => finishQuiz(true)}>Submit Anyway</button></div></div>
            </div>
          )}
        </main>
        <div className="quiz-question-dots" aria-label="Question navigation">
          {quiz.questions.map((item, index) => <button type="button" className={`${index === currentQuestion ? "active" : ""} ${answers[index] !== null ? "answered" : ""}`} onClick={() => setCurrentQuestion(index)} aria-label={`Go to question ${index + 1}`} key={item.id}>{index + 1}</button>)}
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-page">
      <header className="quiz-page-header">
        <div><p className="eyebrow">TEST · LEARN · IMPROVE</p><h1>CLARA Quiz Engine</h1><p>Take teacher-published assessments or build a personal practice quiz from your own study material.</p></div>
        {tab === "practice" && <Link href="/study-workspace" className="quiz-secondary-button">Back to Study Workspace</Link>}
      </header>

      <div className="quiz-mode-tabs" role="tablist" aria-label="Quiz type">
        <button type="button" role="tab" aria-selected={tab === "official"} className={tab === "official" ? "active" : ""} onClick={() => setTab("official")}><span>Official Quizzes</span><small>Teacher published</small></button>
        <button type="button" role="tab" aria-selected={tab === "practice"} className={tab === "practice" ? "active" : ""} onClick={() => setTab("practice")}><span>Practice Quiz</span><small>Your personal workspace</small></button>
      </div>

      {tab === "official" ? <OfficialQuizList onPractice={() => setTab("practice")} /> : <>
      {!configured && <div className="quiz-alert warning"><span>!</span><div><strong>CLARA AI is not configured yet</strong><p>Add GEMINI_API_KEY to .env.local and restart the server to generate quizzes.</p></div></div>}
      {error && <div className="quiz-alert error" role="alert"><span>!</span><div><strong>Quiz generation stopped</strong><p>{error}</p></div><button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

      <div className="quiz-setup-grid">
        <main className="quiz-setup-panel">
          <div className="quiz-section-heading"><div><p>QUIZ CONFIGURATION</p><h2>Build your next challenge</h2></div><span>1 AI call</span></div>

          <section className="quiz-config-section">
            <div className="quiz-config-label"><span>01</span><div><h3>Quiz material</h3><p>{readySources.length ? "Using your active Study Workspace sources" : "Enter a topic for a general academic quiz"}</p></div></div>
            {hydrated && readySources.length > 0 ? (
              <div className="quiz-source-selection">
                {readySources.map((source) => <div key={source.id}><span>✓</span><div><strong>{source.name}</strong><small>{source.type === "youtube" ? "YouTube lecture" : source.mimeType?.startsWith("image/") ? "Study image" : "Course document"}</small></div></div>)}
              </div>
            ) : hydrated ? (
              <label className="quiz-topic-input"><span>Academic topic</span><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={120} placeholder="e.g. Machine Learning" /></label>
            ) : <div className="quiz-loading-line" />}
            {expiredSources.length > 0 && <div className="quiz-expired-note"><span>!</span><p>{expiredSources.length} source{expiredSources.length === 1 ? "" : "s"} need to be uploaded again before they can be used.</p><Link href="/study-workspace">Manage sources</Link></div>}
          </section>

          <section className="quiz-config-section">
            <div className="quiz-config-label"><span>02</span><div><h3>Difficulty</h3><p>Choose the depth of reasoning</p></div></div>
            <div className="quiz-choice-grid three">
              {(["easy", "medium", "hard"] as const).map((level) => <button type="button" className={difficulty === level ? "active" : ""} onClick={() => setDifficulty(level)} key={level}><strong>{level}</strong><small>{level === "easy" ? "Foundations & recall" : level === "medium" ? "Concepts & application" : "Scenarios & deeper reasoning"}</small></button>)}
            </div>
          </section>

          <section className="quiz-config-section">
            <div className="quiz-config-label"><span>03</span><div><h3>Question count</h3><p>Keep it focused and cost-efficient</p></div></div>
            <div className="quiz-choice-grid two">
              {([5, 10] as const).map((count) => <button type="button" className={questionCount === count ? "active" : ""} onClick={() => setQuestionCount(count)} key={count}><strong>{count} questions</strong><small>{count === 5 ? "Quick knowledge check" : "Deeper topic coverage"}</small></button>)}
            </div>
          </section>

          <button className="quiz-generate-button" type="button" disabled={!canGenerate} onClick={() => void generateNewQuiz()}>
            <span>{generating ? "..." : "C"}</span><div><strong>{generating ? "CLARA is preparing your quiz..." : "Start Quiz"}</strong><small>{readySources.length ? `Based on ${readySources.length} active source${readySources.length === 1 ? "" : "s"}` : topic.trim().length >= 2 ? `Topic: ${topic.trim()}` : "Add a topic to continue"}</small></div><b>→</b>
          </button>
        </main>

        <aside className="quiz-history-panel">
          <div className="quiz-section-heading"><div><p>LEARNING TRAIL</p><h2>Recent Quizzes</h2></div><span>{history.length}</span></div>
          <p className="quiz-history-note">Completed attempts stay on this device and prepare your future learning score.</p>
          <div className="quiz-history-list">
            {hydrated && history.length === 0 && <div className="quiz-history-empty"><span>Q</span><strong>No quiz attempts yet</strong><p>Your scores and weak topics will appear here.</p></div>}
            {history.slice(0, 8).map((attempt) => (
              <button type="button" onClick={() => openHistory(attempt)} key={attempt.id}>
                <span className={`quiz-history-score ${attempt.percentage >= 60 ? "good" : "revise"}`}>{attempt.percentage}%</span>
                <div><strong>{attempt.title}</strong><p>{attempt.difficulty} · {attempt.questionCount} questions</p><small>{friendlyDate(attempt.completedAt)}</small></div>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>
      </div>
      </>}
    </div>
  );
}
