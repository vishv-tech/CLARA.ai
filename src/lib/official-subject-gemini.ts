import "server-only";

import type { Interactions } from "@google/genai";
import { getGeminiClient, runWithModelFallback } from "@/lib/gemini";

const FILE_SEARCH_EMBEDDING_MODEL = "models/gemini-embedding-2";
const STORE_OPERATION_TIMEOUT_MS = 120_000;
const OFFICIAL_SYSTEM_INSTRUCTION = `You are CLARA's Official Subject Agent.
Answer only with information supported by the single teacher-managed File Search store attached to this request.
Never use general knowledge to fill gaps. Never invent syllabus coverage, exam rules, deadlines, instructions, marks, dates, or college policy.
If retrieved official evidence is insufficient, set answerableFromOfficialSources to false and say the information was not found in the official subject material.
Keep answers concise and student-friendly.`;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createSubjectStore(displayName: string) {
  const store = await getGeminiClient().fileSearchStores.create({
    config: {
      displayName: displayName.slice(0, 180),
      embeddingModel: FILE_SEARCH_EMBEDDING_MODEL,
      abortSignal: AbortSignal.timeout(45_000),
    },
  });
  if (!store.name) throw new Error("Gemini did not return a File Search store identifier.");
  return store.name;
}

export async function deleteSubjectStore(storeName: string) {
  await getGeminiClient().fileSearchStores.delete({
    name: storeName,
    config: { force: true },
  });
}

export async function uploadSubjectDocument(input: {
  storeName: string;
  file: File;
  mimeType: string;
}) {
  const client = getGeminiClient();
  let operation = await client.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: input.storeName,
    file: input.file,
    config: {
      displayName: input.file.name,
      mimeType: input.mimeType,
      abortSignal: AbortSignal.timeout(STORE_OPERATION_TIMEOUT_MS),
    },
  });

  const deadline = Date.now() + STORE_OPERATION_TIMEOUT_MS;
  while (!operation.done && Date.now() < deadline) {
    await wait(2_000);
    operation = await client.operations.get({ operation }) as typeof operation;
  }

  if (!operation.done || operation.error || !operation.response?.documentName) {
    throw new Error("Gemini could not finish indexing that document.");
  }
  return operation.response.documentName;
}

function extractFileCitations(steps: Interactions.Step[] | undefined) {
  const names = new Set<string>();
  for (const step of steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type !== "text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "file_citation" && annotation.file_name) {
          names.add(annotation.file_name);
        }
      }
    }
  }
  return [...names].slice(0, 6);
}

function officialResponseFormat() {
  return {
    type: "text" as const,
    mime_type: "application/json" as const,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "answerableFromOfficialSources"],
      properties: {
        answer: { type: "string" },
        answerableFromOfficialSources: { type: "boolean" },
      },
    },
  };
}

export async function querySubjectStore(input: {
  storeName: string;
  subjectName: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
}) {
  const history = input.history
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Student" : "CLARA"}: ${message.text}`)
    .join("\n\n");
  const prompt = `Official subject: ${input.subjectName}
${history ? `Recent subject-only conversation:\n${history}\n\n` : ""}Student question: ${input.question}

Return JSON. Set answerableFromOfficialSources to true only when the File Search results directly support the answer.`;

  const { value: interaction, modelUsed } = await runWithModelFallback(
    "subject.chat",
    true,
    (client, model, timeoutMs) => client.interactions.create({
      model,
      input: prompt,
      system_instruction: OFFICIAL_SYSTEM_INSTRUCTION,
      tools: [{
        type: "file_search",
        file_search_store_names: [input.storeName],
      }],
      response_format: officialResponseFormat(),
      store: false,
    }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
  );

  let parsed: { answer?: unknown; answerableFromOfficialSources?: unknown };
  try {
    parsed = JSON.parse(interaction.output_text ?? "{}");
  } catch {
    parsed = {};
  }
  const sources = extractFileCitations(interaction.steps);
  const supported = parsed.answerableFromOfficialSources === true
    && typeof parsed.answer === "string"
    && parsed.answer.trim().length > 0
    && sources.length > 0;

  return {
    answer: supported
      ? String(parsed.answer).trim()
      : `I couldn't find this in the official ${input.subjectName} material. I won't guess.`,
    answerableFromOfficialSources: supported,
    sources: supported ? sources : [],
    modelUsed,
  };
}
