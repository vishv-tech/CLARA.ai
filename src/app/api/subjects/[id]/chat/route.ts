import { geminiErrorResponse } from "@/lib/gemini";
import { querySubjectStore } from "@/lib/official-subject-gemini";
import { authenticateRequest } from "@/lib/server-auth";

export const runtime = "nodejs";

type ChatHistoryItem = { role: "user" | "assistant"; text: string };

export async function POST(request: Request, context: RouteContext<"/api/subjects/[id]/chat">) {
  const auth = await authenticateRequest(request, "student");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const { data: membership } = await auth.client
    .from("subject_memberships")
    .select("id")
    .eq("subject_id", id)
    .eq("student_id", auth.user.id)
    .maybeSingle();
  if (!membership) {
    return Response.json({ error: "Join this subject before using its Official Subject Agent." }, { status: 403 });
  }

  const { data: subject, error: subjectError } = await auth.client
    .from("subjects")
    .select("id,name,file_search_store_name")
    .eq("id", id)
    .maybeSingle();
  if (subjectError || !subject) return Response.json({ error: "Subject not found." }, { status: 404 });

  let body: { message?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ask a valid question." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 4_000) {
    return Response.json({ error: "Ask a question between 1 and 4,000 characters." }, { status: 400 });
  }
  const history: ChatHistoryItem[] = Array.isArray(body.history)
    ? body.history.slice(-8).filter((item): item is ChatHistoryItem =>
      Boolean(item)
      && (item.role === "user" || item.role === "assistant")
      && typeof item.text === "string"
      && item.text.length <= 12_000)
    : [];

  const { count: readySourceCount } = await auth.client
    .from("subject_sources")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", id)
    .eq("status", "ready");
  if (!subject.file_search_store_name || !readySourceCount) {
    return Response.json({
      answer: `I couldn't find this in the official ${subject.name} material. I won't guess.`,
      answerableFromOfficialSources: false,
      sources: [],
    });
  }

  try {
    const result = await querySubjectStore({
      storeName: subject.file_search_store_name,
      subjectName: subject.name,
      question: message,
      history,
    });
    console.info(`[CLARA AI] subject.chat -> ${result.modelUsed}`);
    return Response.json(result);
  } catch (error) {
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
