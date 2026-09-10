import { generateQuiz, generateQuizRecommendation, geminiErrorResponse } from "@/lib/gemini";
import { isStudySourceExpired, isYouTubeUrl, MAX_STUDY_SOURCES } from "@/lib/study-utils";
import type { QuizDifficulty, StudySource } from "@/lib/types";

export const runtime = "nodejs";

function isDifficulty(value: unknown): value is QuizDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isQuestionCount(value: unknown): value is 5 | 10 {
  return value === 5 || value === 10;
}

function validSource(value: unknown): value is StudySource {
  if (!value || typeof value !== "object") return false;
  const source = value as StudySource;
  if (typeof source.id !== "string" || typeof source.name !== "string" || source.name.length > 240) return false;
  if (source.status !== "ready" && source.status !== "needs-reupload") return false;
  if (source.type === "youtube") return typeof source.url === "string" && isYouTubeUrl(source.url);
  return source.type === "file"
    && typeof source.createdAt === "string"
    && typeof source.geminiUri === "string"
    && typeof source.mimeType === "string";
}

function validTopics(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 12
    && value.every((topic) => typeof topic === "string" && topic.trim().length > 0 && topic.length <= 120);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;

    if (body.action === "generate") {
      if (!isDifficulty(body.difficulty) || !isQuestionCount(body.questionCount)) {
        return Response.json({ error: "Choose Easy, Medium, or Hard and either 5 or 10 questions." }, { status: 400 });
      }
      const sources = Array.isArray(body.sources) ? body.sources : [];
      if (sources.length > MAX_STUDY_SOURCES || !sources.every(validSource)) {
        return Response.json({ error: "The quiz source list is invalid or exceeds the 8-source limit." }, { status: 400 });
      }
      if (sources.some(isStudySourceExpired)) {
        return Response.json({
          error: "This study source needs to be uploaded again before generating a quiz.",
          code: "SOURCE_EXPIRED",
        }, { status: 410 });
      }
      const topic = typeof body.topic === "string" ? body.topic.trim() : "";
      if (sources.length === 0 && (topic.length < 2 || topic.length > 120)) {
        return Response.json({ error: "Enter an academic topic between 2 and 120 characters." }, { status: 400 });
      }

      const result = await generateQuiz({
        difficulty: body.difficulty,
        questionCount: body.questionCount,
        sources,
        topic,
      });
      return Response.json(result);
    }

    if (body.action === "recommend") {
      if (
        typeof body.title !== "string"
        || body.title.trim().length < 1
        || body.title.length > 160
        || !isDifficulty(body.difficulty)
        || typeof body.percentage !== "number"
        || !Number.isInteger(body.percentage)
        || body.percentage < 0
        || body.percentage > 100
        || !validTopics(body.weakTopics)
        || !validTopics(body.developingTopics)
        || !validTopics(body.strongTopics)
      ) {
        return Response.json({ error: "The quiz analytics for this recommendation are invalid." }, { status: 400 });
      }

      const result = await generateQuizRecommendation({
        title: body.title.trim(),
        difficulty: body.difficulty,
        percentage: body.percentage,
        weakTopics: body.weakTopics,
        developingTopics: body.developingTopics,
        strongTopics: body.strongTopics,
      });
      return Response.json(result);
    }

    return Response.json({ error: "Choose a supported quiz action." }, { status: 400 });
  } catch (error) {
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
