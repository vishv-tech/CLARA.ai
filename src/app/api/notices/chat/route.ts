import { NOTICE_UNSUPPORTED_ANSWER, queryCollegeNoticeStore } from "@/lib/college-notice-gemini";
import { geminiErrorResponse } from "@/lib/gemini";
import { authenticateRequest } from "@/lib/server-auth";

export const runtime = "nodejs";

type HistoryItem = { role: "user" | "assistant"; text: string };

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, "student");
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid notice question." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Send a valid notice question." }, { status: 400 });
  }
  const body = payload as { message?: unknown; history?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 4000) {
    return Response.json({ error: "Notice questions must be between 1 and 4,000 characters." }, { status: 400 });
  }
  const history: HistoryItem[] = Array.isArray(body.history)
    ? body.history.filter((item): item is HistoryItem => (
      item !== null
      && typeof item === "object"
      && "role" in item
      && (item.role === "user" || item.role === "assistant")
      && "text" in item
      && typeof item.text === "string"
    )).slice(-8)
    : [];

  const [settingsResult, sourcesResult] = await Promise.all([
    auth.client.from("college_notice_settings").select("file_search_store_name").eq("id", 1).maybeSingle(),
    auth.client.from("college_notice_sources").select("id", { count: "exact", head: true }).eq("status", "ready"),
  ]);
  if (settingsResult.error || sourcesResult.error) {
    return Response.json({ error: "CLARA could not access the official notice store." }, { status: 500 });
  }
  if (!settingsResult.data?.file_search_store_name || !sourcesResult.count) {
    return Response.json({
      answer: NOTICE_UNSUPPORTED_ANSWER,
      answerableFromOfficialSources: false,
      sources: [],
    });
  }

  try {
    const result = await queryCollegeNoticeStore({
      storeName: settingsResult.data.file_search_store_name,
      question: message,
      history,
    });
    console.info("[CLARA AI] notice.chat -> success");
    return Response.json(result);
  } catch (error) {
    console.error("[CLARA AI] notice.chat -> failed");
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
