import type { QuizAttempt } from "./types";

const QUIZ_ATTEMPTS_KEY = "sage.quiz.attempts.v1";
const MAX_SAVED_ATTEMPTS = 25;

function readAttempts() {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(QUIZ_ATTEMPTS_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as QuizAttempt[] : [];
  } catch {
    return [];
  }
}

function writeAttempts(attempts: QuizAttempt[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUIZ_ATTEMPTS_KEY, JSON.stringify(attempts.slice(0, MAX_SAVED_ATTEMPTS)));
}

export function getQuizAttempts() {
  return readAttempts();
}

export function saveQuizAttempt(attempt: QuizAttempt) {
  const attempts = [attempt, ...readAttempts().filter((item) => item.id !== attempt.id)];
  writeAttempts(attempts);
  return attempts.slice(0, MAX_SAVED_ATTEMPTS);
}

export function updateQuizRecommendation(attemptId: string, recommendation: string) {
  const attempts = readAttempts().map((attempt) => attempt.id === attemptId ? { ...attempt, recommendation } : attempt);
  writeAttempts(attempts);
  return attempts;
}

export function updateQuizSyncStatus(attemptId: string, remoteSynced: boolean) {
  const attempts = readAttempts().map((attempt) => attempt.id === attemptId ? { ...attempt, remoteSynced } : attempt);
  writeAttempts(attempts);
  return attempts;
}
