import { geminiErrorResponse } from "@/lib/gemini";
import { createSubjectStore, deleteSubjectStore, uploadSubjectDocument } from "@/lib/official-subject-gemini";
import { authenticateRequest } from "@/lib/server-auth";
import { getSupportedMimeType, MAX_UPLOAD_BYTES } from "@/lib/study-utils";

export const runtime = "nodejs";

const OFFICIAL_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, "teacher");
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a PDF, DOCX, TXT, or Markdown notice." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Official notices must be under 25 MB." }, { status: 413 });
  }
  const mimeType = getSupportedMimeType(file.name, file.type);
  if (!mimeType || !OFFICIAL_MIME_TYPES.has(mimeType)) {
    return Response.json({ error: "Official notices support PDF, DOCX, TXT, and Markdown files." }, { status: 415 });
  }

  let settings = await auth.client
    .from("college_notice_settings")
    .select("file_search_store_name")
    .eq("id", 1)
    .maybeSingle();
  if (settings.error) {
    return Response.json({ error: "CLARA could not access the college notice store." }, { status: 500 });
  }

  let storeName = settings.data?.file_search_store_name;
  try {
    if (!storeName) {
      const candidateStore = await createSubjectStore("CLARA Official College Notices");
      const insertResult = await auth.client.from("college_notice_settings").insert({
        id: 1,
        file_search_store_name: candidateStore,
        created_by: auth.user.id,
      });
      if (insertResult.error) {
        settings = await auth.client
          .from("college_notice_settings")
          .select("file_search_store_name")
          .eq("id", 1)
          .maybeSingle();
        if (!settings.data?.file_search_store_name) {
          await deleteSubjectStore(candidateStore).catch(() => undefined);
          throw insertResult.error;
        }
        await deleteSubjectStore(candidateStore).catch(() => undefined);
        storeName = settings.data.file_search_store_name;
      } else {
        storeName = candidateStore;
      }
    }

    const { data: source, error: sourceError } = await auth.client
      .from("college_notice_sources")
      .insert({ uploaded_by: auth.user.id, name: file.name, mime_type: mimeType, status: "processing" })
      .select("id,uploaded_by,name,mime_type,gemini_file_search_document_name,status,created_at")
      .single();
    if (sourceError || !source) {
      return Response.json({ error: "CLARA could not register that official notice." }, { status: 500 });
    }

    try {
      const documentName = await uploadSubjectDocument({ storeName, file, mimeType });
      const { data: readySource, error: updateError } = await auth.client
        .from("college_notice_sources")
        .update({ gemini_file_search_document_name: documentName, status: "ready" })
        .eq("id", source.id)
        .select("id,uploaded_by,name,mime_type,gemini_file_search_document_name,status,created_at")
        .single();
      if (updateError || !readySource) throw new Error("The notice was indexed but its status could not be saved.");
      console.info("[CLARA AI] notice.upload -> success");
      return Response.json({ source: readySource }, { status: 201 });
    } catch (error) {
      await auth.client.from("college_notice_sources").update({ status: "failed" }).eq("id", source.id);
      throw error;
    }
  } catch (error) {
    console.error("[CLARA AI] notice.upload -> failed");
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
