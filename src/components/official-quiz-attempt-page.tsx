"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatQuizDuration, scoreLabel } from "@/lib/quiz-utils";
import { supabase } from "@/lib/supabase";
import type { OfficialQuizResult, SubjectQuiz, SubjectQuizQuestion } from "@/lib/types";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

type QuizContext = SubjectQuiz & { subjectName: string; teacherName: string };

function rpcMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("already submitted")) return "You have already submitted this quiz.";
  if (normalized.includes("deadline")) return "This quiz deadline has passed.";
  if (normalized.includes("published quiz not found")) return "This quiz is not available to your account.";
  return "CLARA could not submit this quiz. Please try again.";
}

function ResultView({ result }: { result: OfficialQuizResult }) {
  return <div className="quiz-page official-result-page">
    <Link className="official-back" href="/quiz">← Official Quizzes</Link>
    <section className="quiz-result-panel">
      <div className="quiz-result-hero">
        <span className="quiz-result-icon">✓</span><p className="eyebrow">OFFICIAL QUIZ COMPLETE</p>
        <h1>{result.correctCount} / {result.questionCount}</h1><strong>{result.percentage}%</strong>
        <h2>{scoreLabel(result.percentage)}</h2><p>{result.title} · {result.subjectName}</p>
      </div>
      <div className="quiz-result-stats">
        <div><span>Correct</span><strong>{result.correctCount}</strong></div>
        <div><span>Incorrect</span><strong>{result.incorrectCount}</strong></div>
        <div><span>Unanswered</span><strong>{result.unansweredCount}</strong></div>
        <div><span>Duration</span><strong>{formatQuizDuration(result.durationSeconds)}</strong></div>
      </div>
      <div className="official-result-review-heading"><p>ANSWER REVIEW</p><h2>Learn from every answer</h2></div>
      <div className="quiz-review-list">
        {result.questions.map((question) => {
          const correct = question.selectedIndex === question.correctIndex;
          return <article className={`quiz-review-card ${correct ? "correct" : "incorrect"}`} key={question.id}>
            <div className="quiz-review-number"><span>{question.position + 1}</span><b>{correct ? "Correct" : question.selectedIndex === null ? "Unanswered" : "Incorrect"}</b></div>
            <div className="quiz-review-content">
              <span className="quiz-topic-chip">{question.topic}</span><h2>{question.question}</h2>
              <div className="quiz-review-answers">
                <div><span>Your answer</span><strong>{question.selectedIndex === null ? "No answer" : `${OPTION_LABELS[question.selectedIndex]} — ${question.options[question.selectedIndex]}`}</strong></div>
                <div><span>Correct answer</span><strong>{OPTION_LABELS[question.correctIndex]} — {question.options[question.correctIndex]}</strong></div>
              </div>
              <div className="quiz-explanation"><span>WHY THIS IS CORRECT</span><p>{question.explanation}</p></div>
            </div>
          </article>;
        })}
      </div>
      <div className="quiz-result-actions"><Link href="/quiz" className="quiz-primary-button">Back to Official Quizzes</Link></div>
    </section>
  </div>;
}

export function OfficialQuizAttemptPage() {
  const { id } = useParams<{ id: string }>();
  const [quiz, setQuiz] = useState<QuizContext | null>(null);
  const [questions, setQuestions] = useState<SubjectQuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Array<number | null>>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<OfficialQuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState("");

  const loadQuiz = useCallback(async () => {
    if (!supabase || !id) return;
    setLoading(true);
    setError("");
    const quizResult = await supabase.from("subject_quizzes").select("*").eq("id", id).eq("status", "published").maybeSingle();
    const quizRow = quizResult.data as SubjectQuiz | null;
    if (quizResult.error || !quizRow) {
      setError("This quiz is not published or is not available to your account.");
      setLoading(false);
      return;
    }

    const attemptResult = await supabase.from("subject_quiz_attempts").select("id").eq("quiz_id", id).maybeSingle();
    if (attemptResult.data) {
      const resultResponse = await supabase.rpc("get_subject_quiz_result", { requested_quiz_id: id });
      if (resultResponse.error || !resultResponse.data) setError("CLARA could not load your completed result.");
      else setResult(resultResponse.data as OfficialQuizResult);
      setLoading(false);
      return;
    }

    if (quizRow.due_at && new Date(quizRow.due_at).getTime() <= Date.now()) {
      setQuiz({ ...quizRow, subjectName: "Official Subject", teacherName: "Your teacher" });
      setClosed(true);
      setLoading(false);
      return;
    }

    const [questionResult, subjectResult] = await Promise.all([
      supabase.from("subject_quiz_questions").select("id,quiz_id,position,question,options,topic,created_at").eq("quiz_id", id).order("position"),
      supabase.from("subjects").select("name,teacher_id").eq("id", quizRow.subject_id).maybeSingle(),
    ]);
    const questionRows = (questionResult.data ?? []) as SubjectQuizQuestion[];
    if (questionResult.error || subjectResult.error || !subjectResult.data || questionRows.length !== quizRow.question_count) {
      setError("This official quiz is incomplete and cannot be attempted.");
      setLoading(false);
      return;
    }
    const teacherResult = await supabase.from("profiles").select("full_name").eq("id", subjectResult.data.teacher_id).maybeSingle();
    setQuiz({ ...quizRow, subjectName: String(subjectResult.data.name), teacherName: String(teacherResult.data?.full_name || "Your teacher") });
    setQuestions(questionRows);
    setAnswers(Array.from({ length: questionRows.length }, () => null));
    setStartedAt(Date.now());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQuiz(), 0);
    return () => window.clearTimeout(timer);
  }, [loadQuiz]);

  async function submit(submitAnyway = false) {
    if (!supabase || !quiz || submitting) return;
    const unanswered = answers.filter((answer) => answer === null).length;
    if (unanswered && !submitAnyway) {
      setConfirmSubmit(true);
      return;
    }
    setConfirmSubmit(false);
    setSubmitting(true);
    setError("");
    const response = await supabase.rpc("submit_subject_quiz", {
      requested_quiz_id: quiz.id,
      submitted_answers: answers,
      requested_duration_seconds: Math.max(0, Math.min(86400, Math.round((Date.now() - startedAt) / 1000))),
    });
    if (response.error || !response.data) setError(rpcMessage(response.error?.message || ""));
    else setResult(response.data as OfficialQuizResult);
    setSubmitting(false);
  }

  if (loading) return <div className="quiz-page"><div className="official-quiz-loading">Opening official quiz…</div></div>;
  if (result) return <ResultView result={result} />;
  if (error && !quiz) return <div className="quiz-page"><div className="quiz-alert error"><span>!</span><div><strong>Quiz unavailable</strong><p>{error}</p></div></div><Link href="/quiz" className="quiz-secondary-button">Back to Official Quizzes</Link></div>;
  if (closed || !quiz) return <div className="quiz-page"><div className="official-quiz-empty"><span>!</span><h2>This official quiz is closed.</h2><p>The deadline passed before an attempt was submitted.</p><div><Link href="/quiz" className="quiz-primary-button">Back to Official Quizzes</Link></div></div></div>;

  const question = questions[currentQuestion];
  const answeredCount = answers.filter((answer) => answer !== null).length;
  const unansweredCount = questions.length - answeredCount;
  return <div className="quiz-page quiz-taking-page">
    <header className="quiz-taking-header">
      <div><p className="eyebrow">OFFICIAL · {quiz.subjectName.toUpperCase()}</p><h1>{quiz.title}</h1><p><span>{quiz.difficulty}</span>{quiz.teacherName} · {quiz.due_at ? `Due ${new Date(quiz.due_at).toLocaleString()}` : "No deadline"}</p></div>
      <Link href="/quiz">Exit Quiz</Link>
    </header>
    {error && <div className="quiz-alert error" role="alert"><span>!</span><div><strong>Submission stopped</strong><p>{error}</p></div></div>}
    <div className="quiz-progress-row"><span>Question {currentQuestion + 1} of {questions.length}</span><div><i style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }} /></div><b>{answeredCount}/{questions.length} answered</b></div>
    <main className="quiz-question-card">
      <div className="quiz-question-meta"><span>QUESTION {currentQuestion + 1}</span><b>{question.topic}</b></div>
      <h2>{question.question}</h2>
      <div className="quiz-options" role="radiogroup" aria-label={`Answers for question ${currentQuestion + 1}`}>
        {question.options.map((option, index) => <button type="button" role="radio" aria-checked={answers[currentQuestion] === index} className={answers[currentQuestion] === index ? "selected" : ""} onClick={() => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === currentQuestion ? index : answer))} key={`${question.id}-${index}`}><span>{OPTION_LABELS[index]}</span><p>{option}</p><i /></button>)}
      </div>
      <div className="quiz-navigation">
        <button type="button" className="quiz-secondary-button" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((current) => current - 1)}>Previous</button>
        {currentQuestion < questions.length - 1 ? <button type="button" className="quiz-primary-button" onClick={() => setCurrentQuestion((current) => current + 1)}>Next Question</button> : <button type="button" className="quiz-primary-button submit" disabled={submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Submit Quiz"}</button>}
      </div>
      {confirmSubmit && <div className="quiz-submit-confirm" role="dialog" aria-modal="true" aria-label="Confirm quiz submission"><div><span>!</span><h3>You still have {unansweredCount} unanswered question{unansweredCount === 1 ? "" : "s"}.</h3><p>You can return to complete them or submit the quiz as it is.</p><div><button type="button" className="quiz-secondary-button" onClick={() => setConfirmSubmit(false)}>Go Back</button><button type="button" className="quiz-primary-button" onClick={() => void submit(true)}>Submit Anyway</button></div></div></div>}
    </main>
    <div className="quiz-question-dots" aria-label="Question navigation">{questions.map((item, index) => <button type="button" className={`${index === currentQuestion ? "active" : ""} ${answers[index] !== null ? "answered" : ""}`} onClick={() => setCurrentQuestion(index)} aria-label={`Go to question ${index + 1}`} key={item.id}>{index + 1}</button>)}</div>
  </div>;
}
