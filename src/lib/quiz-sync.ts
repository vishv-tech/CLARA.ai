import { supabase } from "./supabase";
import type { QuizAttempt } from "./types";

export async function syncQuizAttempt(attempt: QuizAttempt, userId: string) {
  if (!supabase) return false;

  const { error } = await supabase.from("quiz_attempts").upsert({
    user_id: userId,
    local_attempt_id: attempt.id,
    completed_at: attempt.completedAt,
    difficulty: attempt.difficulty,
    question_count: attempt.questionCount,
    percentage: attempt.percentage,
    duration_seconds: attempt.durationSeconds,
  }, { onConflict: "user_id,local_attempt_id", ignoreDuplicates: true });

  if (error) {
    console.warn("SAGE quiz attempt sync failed; the local result is safe.", error.message);
    return false;
  }

  return true;
}
