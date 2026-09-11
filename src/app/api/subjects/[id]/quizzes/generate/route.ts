import { geminiErrorResponse } from "@/lib/gemini";
import { generateOfficialSubjectQuiz } from "@/lib/official-subject-gemini";
import { authenticateRequest } from "@/lib/server-auth";
import type { QuizDifficulty } from "@/lib/types";

export const runtime = "nodejs";

function validDifficulty(value: unknown): value is QuizDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function validQuestionCount(value: unknown): value is 5 | 10 {
  return value === 5 || value === 10;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/subjects/[id]/quizzes/generate">,
) {
  const auth = await authenticateRequest(request, "teacher");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Enter valid quiz details." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 2 || title.length > 160) {
    return Response.json({ error: "Quiz title must be between 2 and 160 characters." }, { status: 400 });
  }
  if (!validDifficulty(body.difficulty) || !validQuestionCount(body.questionCount)) {
    return Response.json({ error: "Choose Easy, Medium, or Hard and either 5 or 10 questions." }, { status: 400 });
  }
  const dueAt = typeof body.dueAt === "string" && body.dueAt.trim() ? new Date(body.dueAt) : null;
  if (dueAt && (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now())) {
    return Response.json({ error: "Choose a due date in the future, or leave it blank." }, { status: 400 });
  }

  const { data: subject, error: subjectError } = await auth.client
    .from("subjects")
    .select("id,name,teacher_id,file_search_store_name")
    .eq("id", id)
    .eq("teacher_id", auth.user.id)
    .maybeSingle();
  if (subjectError || !subject) {
    return Response.json({ error: "Subject not found, or you are not its teacher." }, { status: 404 });
  }
  if (!subject.file_search_store_name) {
    return Response.json({ error: "This subject's official knowledge store is not ready." }, { status: 409 });
  }

  const { data: sources, error: sourceError } = await auth.client
    .from("subject_sources")
    .select("id,name")
    .eq("subject_id", id)
    .eq("status", "ready")
    .order("created_at");
  if (sourceError) return Response.json({ error: "CLARA could not verify this subject's sources." }, { status: 500 });
  if (!sources?.length) {
    return Response.json({ error: "Upload official subject material before generating a quiz." }, { status: 409 });
  }

  let generated;
  try {
    generated = await generateOfficialSubjectQuiz({
      storeName: subject.file_search_store_name,
      subjectName: subject.name,
      title,
      difficulty: body.difficulty,
      questionCount: body.questionCount,
      sourceNames: sources.map((source) => String(source.name)),
    });
  } catch (error) {
    const response = geminiErrorResponse(error);
    return Response.json({ error: "CLARA couldn't generate the quiz right now. Please try again.", code: response.code }, { status: response.status });
  }

  const quizId = crypto.randomUUID();
  const questionRows = generated.quiz.questions.map((question, position) => ({
    id: crypto.randomUUID(),
    quiz_id: quizId,
    position,
    question: question.question,
    options: question.options,
    topic: question.topic,
  }));
  const answerRows = generated.quiz.questions.map((question, position) => ({
    question_id: questionRows[position].id,
    correct_index: question.correctOptionIndex,
    explanation: question.explanation,
  }));

  const { data: quiz, error: quizError } = await auth.client
    .from("subject_quizzes")
    .insert({
      id: quizId,
      subject_id: id,
      teacher_id: auth.user.id,
      title,
      difficulty: body.difficulty,
      question_count: body.questionCount,
      status: "draft",
      due_at: dueAt?.toISOString() ?? null,
    })
    .select("*")
    .single();
  if (quizError || !quiz) {
    return Response.json({ error: "The generated quiz could not be saved." }, { status: 500 });
  }

  const { error: questionError } = await auth.client.from("subject_quiz_questions").insert(questionRows);
  const { error: answerError } = questionError
    ? { error: questionError }
    : await auth.client.from("subject_quiz_answer_keys").insert(answerRows);
  if (questionError || answerError) {
    await auth.client.from("subject_quizzes").delete().eq("id", quizId).eq("status", "draft");
    return Response.json({ error: "The generated quiz could not be saved completely." }, { status: 500 });
  }

  console.info(`[CLARA AI] subject.quiz.generate -> ${generated.modelUsed}; ${generated.citations.length} official citation(s)`);
  return Response.json({
    quiz,
    questions: questionRows.map((question, position) => ({
      ...question,
      correct_index: answerRows[position].correct_index,
      explanation: answerRows[position].explanation,
    })),
  }, { status: 201 });
}
