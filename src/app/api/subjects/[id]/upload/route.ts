import { geminiErrorResponse } from "@/lib/gemini";
import { uploadSubjectDocument } from "@/lib/official-subject-gemini";
import { authenticateRequest } from "@/lib/server-auth";
import { getSupportedMimeType, MAX_UPLOAD_BYTES } from "@/lib/study-utils";

export const runtime = "nodejs";

const OFFICIAL_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

export async function POST(request: Request, context: RouteContext<"/api/subjects/[id]/upload">) {
  const auth = await authenticateRequest(request, "teacher");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const { data: subject, error: subjectError } = await auth.client
    .from("subjects")
    .select("id,file_search_store_name")
    .eq("id", id)
    .eq("teacher_id", auth.user.id)
    .maybeSingle();
  if (subjectError || !subject) {
    return Response.json({ error: "Subject not found, or you are not its teacher." }, { status: 404 });
  }
  if (!subject.file_search_store_name) {
    return Response.json({ error: "This subject's official knowledge store is not ready." }, { status: 409 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a PDF, DOCX, TXT, or Markdown file." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Official material must be under 25 MB." }, { status: 413 });
  }
  const mimeType = getSupportedMimeType(file.name, file.type);
  if (!mimeType || !OFFICIAL_MIME_TYPES.has(mimeType)) {
    return Response.json({ error: "Official subjects support PDF, DOCX, TXT, and Markdown files." }, { status: 415 });
  }

  const { data: source, error: sourceError } = await auth.client
    .from("subject_sources")
    .insert({
      subject_id: subject.id,
      uploaded_by: auth.user.id,
      name: file.name,
      mime_type: mimeType,
      status: "processing",
    })
    .select("id,subject_id,uploaded_by,name,mime_type,gemini_file_search_document_name,status,created_at")
    .single();
  if (sourceError || !source) {
    return Response.json({ error: "CLARA could not register that official source." }, { status: 500 });
  }

  try {
    const documentName = await uploadSubjectDocument({
      storeName: subject.file_search_store_name,
      file,
      mimeType,
    });
    const { data: readySource, error: updateError } = await auth.client
      .from("subject_sources")
      .update({
        gemini_file_search_document_name: documentName,
        status: "ready",
      })
      .eq("id", source.id)
      .select("id,subject_id,uploaded_by,name,mime_type,gemini_file_search_document_name,status,created_at")
      .single();
    if (updateError || !readySource) throw new Error("The source was indexed but its status could not be saved.");
    console.info("[CLARA AI] subject.upload -> success");
    return Response.json({ source: readySource }, { status: 201 });
  } catch (error) {
    await auth.client.from("subject_sources").update({ status: "failed" }).eq("id", source.id);
    console.error("[CLARA AI] subject.upload -> failed");
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
