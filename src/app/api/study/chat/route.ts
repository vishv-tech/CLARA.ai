import { askGemini, geminiErrorResponse } from "@/lib/gemini";
import { isYouTubeUrl, MAX_STUDY_SOURCES } from "@/lib/study-utils";
import type { StudyMessage, StudyMode, StudySource } from "@/lib/types";

export const runtime = "nodejs";

function validSource(source: StudySource) {
  if (!source || typeof source.name !== "string" || source.name.length > 240) return false;
  if (source.type === "youtube") return typeof source.url === "string" && isYouTubeUrl(source.url);
  return source.type === "file" && typeof source.geminiUri === "string" && typeof source.mimeType === "string";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      message?: unknown;
      mode?: unknown;
      sources?: unknown;
      history?: unknown;
    };

    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 4_000) {
      return Response.json({ error: "Ask CLARA a question between 1 and 4,000 characters." }, { status: 400 });
    }
    if (body.mode !== "course" && body.mode !== "explore") {
      return Response.json({ error: "Choose Course Mode or Explore Mode." }, { status: 400 });
    }
    if (!Array.isArray(body.sources) || body.sources.length > MAX_STUDY_SOURCES || !body.sources.every(validSource)) {
      return Response.json({ error: "The attached source list is invalid or exceeds the 8-source limit." }, { status: 400 });
    }

    const history = Array.isArray(body.history)
      ? body.history.slice(-8).filter((item): item is StudyMessage =>
        Boolean(item) && (item.role === "user" || item.role === "assistant") && typeof item.text === "string" && item.text.length <= 12_000)
      : [];

    const result = await askGemini({
      message: body.message.trim(),
      mode: body.mode as StudyMode,
      sources: body.sources as StudySource[],
      history,
    });
    return Response.json(result);
  } catch (error) {
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
