import { geminiErrorResponse, uploadStudyFile } from "@/lib/gemini";
import { getSupportedMimeType, MAX_UPLOAD_BYTES } from "@/lib/study-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "Choose a supported study file to upload." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "This file is too large for the SAGE hackathon workspace. Please upload a file under 25 MB." }, { status: 413 });
    }

    const mimeType = getSupportedMimeType(file.name, file.type);
    if (!mimeType) {
      return Response.json({ error: "SAGE supports PDF, DOCX, TXT, Markdown, PNG, JPG, and WEBP files." }, { status: 415 });
    }

    const uploaded = await uploadStudyFile(file, mimeType);
    return Response.json({
      source: {
        id: `source-${crypto.randomUUID()}`,
        type: "file",
        name: file.name,
        ...uploaded,
        createdAt: new Date().toISOString(),
        status: "ready",
      },
    });
  } catch (error) {
    const response = geminiErrorResponse(error);
    return Response.json({ error: response.message, code: response.code }, { status: response.status });
  }
}
