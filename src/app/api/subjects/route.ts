import { authenticateRequest } from "@/lib/server-auth";
import { createSubjectStore, deleteSubjectStore } from "@/lib/official-subject-gemini";

export const runtime = "nodejs";

function createJoinCode(subjectCode: string) {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
  return `${subjectCode.slice(0, 8)}-${suffix}`;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, "teacher");
  if (!auth.ok) return auth.response;

  let body: { name?: unknown; code?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter valid subject details." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const code = typeof body.code === "string"
    ? body.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
    : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "Subject name must be between 2 and 120 characters." }, { status: 400 });
  }
  if (code.length < 2) {
    return Response.json({ error: "Subject code needs at least two letters or numbers." }, { status: 400 });
  }
  if (description.length > 500) {
    return Response.json({ error: "Keep the description under 500 characters." }, { status: 400 });
  }

  let storeName: string | undefined;
  try {
    storeName = await createSubjectStore(`CLARA ${code} — ${name}`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await auth.client
        .from("subjects")
        .insert({
          name,
          code,
          description: description || null,
          teacher_id: auth.user.id,
          join_code: createJoinCode(code),
          file_search_store_name: storeName,
        })
        .select("id,name,code,description,teacher_id,join_code,file_search_store_name,created_at,updated_at")
        .single();
      if (!error && data) return Response.json({ subject: data }, { status: 201 });
      if (error?.code !== "23505" || attempt === 2) {
        throw new Error("The subject could not be saved.");
      }
    }
    throw new Error("The subject could not be saved.");
  } catch (error) {
    if (storeName) {
      try {
        await deleteSubjectStore(storeName);
      } catch {
        console.warn("[CLARA AI] Could not clean up an unused subject store.");
      }
    }
    const message = error instanceof Error ? error.message : "The subject could not be created.";
    return Response.json({ error: message }, { status: 502 });
  }
}
