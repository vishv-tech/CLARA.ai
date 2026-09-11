"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OfficialSubject, SubjectQuiz, SubjectQuizAttempt } from "@/lib/types";

type OfficialQuizCard = SubjectQuiz & {
  subjectName: string;
  subjectCode: string;
  teacherName: string;
  attempt?: SubjectQuizAttempt;
};

function deadlineLabel(value: string | null) {
  if (!value) return "No deadline";
  return `Due ${new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

function quizState(quiz: OfficialQuizCard) {
  if (quiz.attempt) return "completed" as const;
  if (quiz.due_at && new Date(quiz.due_at).getTime() <= Date.now()) return "closed" as const;
  return "available" as const;
}

export function OfficialQuizList({ onPractice }: { onPractice: () => void }) {
  const [quizzes, setQuizzes] = useState<OfficialQuizCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadQuizzes = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const membershipResult = await supabase.from("subject_memberships").select("subject_id");
    if (membershipResult.error) {
      setError("CLARA could not load your official quizzes.");
      setLoading(false);
      return;
    }
    const subjectIds = (membershipResult.data ?? []).map((membership) => String(membership.subject_id));
    if (!subjectIds.length) {
      setQuizzes([]);
      setLoading(false);
      return;
    }

    const [quizResult, subjectResult] = await Promise.all([
      supabase.from("subject_quizzes").select("*").in("subject_id", subjectIds).eq("status", "published").order("created_at", { ascending: false }),
      supabase.from("subjects").select("*").in("id", subjectIds),
    ]);
    if (quizResult.error || subjectResult.error) {
      setError("CLARA could not load your official quizzes.");
      setLoading(false);
      return;
    }

    const quizRows = (quizResult.data ?? []) as SubjectQuiz[];
    const subjects = (subjectResult.data ?? []) as OfficialSubject[];
    const teacherIds = [...new Set(subjects.map((subject) => subject.teacher_id))];
    const [teacherResult, attemptResult] = await Promise.all([
      teacherIds.length ? supabase.from("profiles").select("id,full_name").in("id", teacherIds) : Promise.resolve({ data: [], error: null }),
      quizRows.length ? supabase.from("subject_quiz_attempts").select("*").in("quiz_id", quizRows.map((quiz) => quiz.id)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (teacherResult.error || attemptResult.error) {
      setError("CLARA could not finish loading your quiz status.");
      setLoading(false);
      return;
    }

    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const teacherById = new Map((teacherResult.data ?? []).map((teacher) => [String(teacher.id), String(teacher.full_name)]));
    const attemptByQuiz = new Map(((attemptResult.data ?? []) as SubjectQuizAttempt[]).map((attempt) => [attempt.quiz_id, attempt]));
    setQuizzes(quizRows.map((quiz) => {
      const subject = subjectById.get(quiz.subject_id);
      return {
        ...quiz,
        subjectName: subject?.name ?? "Official Subject",
        subjectCode: subject?.code ?? "OFFICIAL",
        teacherName: teacherById.get(quiz.teacher_id) ?? "Your teacher",
        attempt: attemptByQuiz.get(quiz.id),
      };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQuizzes(), 0);
    return () => window.clearTimeout(timer);
  }, [loadQuizzes]);

  if (loading) return <div className="official-quiz-loading">Loading official quizzes…</div>;
  if (error) return <div className="quiz-alert error" role="alert"><span>!</span><div><strong>Official quizzes unavailable</strong><p>{error}</p></div><button type="button" onClick={() => void loadQuizzes()}>Retry</button></div>;

  const available = quizzes.filter((quiz) => quizState(quiz) === "available");
  const completed = quizzes.filter((quiz) => quizState(quiz) === "completed");
  const closed = quizzes.filter((quiz) => quizState(quiz) === "closed");

  if (!quizzes.length) return <section className="official-quiz-empty">
    <span>Q</span>
    <h2>No official quizzes are available yet.</h2>
    <p>Join a subject or wait for your teacher to publish one.</p>
    <div><Link href="/subjects" className="quiz-primary-button">Go to My Subjects</Link><button type="button" className="quiz-secondary-button" onClick={onPractice}>Open Practice Quiz</button></div>
  </section>;

  function group(title: string, items: OfficialQuizCard[]) {
    if (!items.length) return null;
    return <section className="official-quiz-group">
      <div className="quiz-section-heading"><div><p>OFFICIAL QUIZZES</p><h2>{title}</h2></div><span>{items.length}</span></div>
      <div className="official-quiz-cards">{items.map((quiz) => {
        const state = quizState(quiz);
        return <article className={`official-quiz-card ${state}`} key={quiz.id}>
          <div className="official-quiz-card-top"><span>{quiz.subjectCode}</span><b>OFFICIAL</b><em>{state}</em></div>
          <h3>{quiz.title}</h3>
          <p>{quiz.subjectName}</p>
          <div className="official-quiz-teacher">Maintained by {quiz.teacherName}</div>
          <div className="official-quiz-meta"><span>{quiz.difficulty}</span><span>{quiz.question_count} Questions</span><span>{deadlineLabel(quiz.due_at)}</span></div>
          {quiz.attempt ? <div className="official-quiz-score"><strong>{quiz.attempt.percentage}%</strong><span>{quiz.attempt.correct_count} / {quiz.question_count}</span></div> : null}
          {state === "available" && <Link href={`/quiz/${quiz.id}`} className="quiz-primary-button">Attempt Quiz</Link>}
          {state === "completed" && <Link href={`/quiz/${quiz.id}`} className="quiz-secondary-button">Review Result</Link>}
          {state === "closed" && <span className="official-quiz-closed">Deadline passed</span>}
        </article>;
      })}</div>
    </section>;
  }

  return <div className="official-quiz-list">{group("Available", available)}{group("Completed", completed)}{group("Closed", closed)}</div>;
}
