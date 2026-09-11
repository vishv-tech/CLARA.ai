import { authenticateRequest } from "@/lib/server-auth";

export const runtime = "nodejs";

async function findOwnedDraft(
  request: Request,
  subjectId: string,
  quizId: string,
) {
  const auth = await authenticateRequest(request, "teacher");
  if (!auth.ok) return auth;
  const { data: quiz, error } = await auth.client
    .from("subject_quizzes")
    .select("id,subject_id,teacher_id,question_count,status")
    .eq("id", quizId)
    .eq("subject_id", subjectId)
    .eq("teacher_id", auth.user.id)
    .maybeSingle();
  if (error || !quiz) {
    return { ok: false as const, response: Response.json({ error: "Quiz not found, or you are not its teacher." }, { status: 404 }) };
  }
  return { ...auth, quiz };
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/subjects/[id]/quizzes/[quizId]">,
) {
  const { id, quizId } = await context.params;
  const owned = await findOwnedDraft(request, id, quizId);
  if (!owned.ok) return owned.response;
  if (owned.quiz.status !== "draft") {
    return Response.json({ error: "Only draft quizzes can be published." }, { status: 409 });
  }

  const { data: questions, error: questionError } = await owned.client
    .from("subject_quiz_questions")
    .select("id,position")
    .eq("quiz_id", quizId)
    .order("position");
  if (questionError || questions?.length !== owned.quiz.question_count) {
    return Response.json({ error: "This draft does not contain the expected number of questions." }, { status: 409 });
  }
  const expectedPositions = questions.every((question, index) => question.position === index);
  const { count: answerCount, error: answerError } = await owned.client
    .from("subject_quiz_answer_keys")
    .select("question_id", { count: "exact", head: true })
    .in("question_id", questions.map((question) => question.id));
  if (!expectedPositions || answerError || answerCount !== owned.quiz.question_count) {
    return Response.json({ error: "This draft has an incomplete answer key and cannot be published." }, { status: 409 });
  }

  const publishedAt = new Date().toISOString();
  const { data: quiz, error } = await owned.client
    .from("subject_quizzes")
    .update({ status: "published", published_at: publishedAt })
    .eq("id", quizId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error || !quiz) return Response.json({ error: "CLARA could not publish this quiz." }, { status: 500 });
  return Response.json({ quiz });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/subjects/[id]/quizzes/[quizId]">,
) {
  const { id, quizId } = await context.params;
  const owned = await findOwnedDraft(request, id, quizId);
  if (!owned.ok) return owned.response;
  if (owned.quiz.status !== "draft") {
    return Response.json({ error: "Published quizzes cannot be deleted." }, { status: 409 });
  }

  const { data, error } = await owned.client
    .from("subject_quizzes")
    .delete()
    .eq("id", quizId)
    .eq("status", "draft")
    .select("id")
    .single();
  if (error || !data) return Response.json({ error: "CLARA could not delete this draft." }, { status: 500 });
  return Response.json({ deleted: true });
}
