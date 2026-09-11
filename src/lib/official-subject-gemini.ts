import "server-only";

import type { Interactions } from "@google/genai";
import { GeminiQuizFormatError, getGeminiClient, runWithModelFallback } from "@/lib/gemini";
import { normalizeQuizPayload } from "@/lib/quiz-utils";
import type { QuizDifficulty } from "@/lib/types";

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

function officialQuizResponseFormat(difficulty: QuizDifficulty, questionCount: 5 | 10) {
  return {
    type: "text" as const,
    mime_type: "application/json" as const,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "difficulty", "questions"],
      properties: {
        title: { type: "string" },
        difficulty: { type: "string", enum: [difficulty] },
        questions: {
          type: "array",
          minItems: questionCount,
          maxItems: questionCount,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "options", "correctOptionIndex", "topic", "explanation"],
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correctOptionIndex: { type: "integer", minimum: 0, maximum: 3 },
              topic: { type: "string" },
              explanation: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export async function generateOfficialSubjectQuiz(input: {
  storeName: string;
  subjectName: string;
  title: string;
  difficulty: QuizDifficulty;
  questionCount: 5 | 10;
  sourceNames: string[];
}) {
  const prompt = `Create the official classroom assessment titled "${input.title}" for ${input.subjectName}.
Generate exactly ${input.questionCount} ${input.difficulty} multiple-choice questions using only evidence retrieved from the attached teacher-managed File Search store.
Do not use general knowledge, other subject material, web results, or unstated assumptions.
Easy means foundational recall and understanding. Medium means concepts and moderate application. Hard means deeper reasoning, scenarios, and conceptual distinctions.
Each question must be unique and unambiguous, with exactly four distinct plausible options, one correct option index from 0 to 3, a concise topic, and a short evidence-based explanation. Return only the requested JSON.`;

  const { value: interaction, modelUsed } = await runWithModelFallback(
    "subject.quiz.generate",
    true,
    (client, model, timeoutMs) => client.interactions.create({
      model,
      input: prompt,
      system_instruction: "You generate CLARA official assessments. Use only the single attached teacher File Search store. If the store cannot support the requested assessment, do not fill gaps with general knowledge.",
      tools: [{ type: "file_search", file_search_store_names: [input.storeName] }],
      response_format: officialQuizResponseFormat(input.difficulty, input.questionCount),
      store: false,
    }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
  );

  const output = interaction.output_text?.trim();
  if (!output) throw new GeminiQuizFormatError("CLARA could not create a complete official quiz.");
  let payload: unknown;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new GeminiQuizFormatError("CLARA returned an incomplete official quiz.");
  }
  const quiz = normalizeQuizPayload(
    payload,
    input.difficulty,
    input.questionCount,
    [],
    input.sourceNames,
  );
  const citations = extractFileCitations(interaction.steps);
  if (!quiz || citations.length === 0) {
    throw new GeminiQuizFormatError("CLARA could not ground this quiz in the official subject material. Try again after checking the uploaded source.");
  }

  return {
    quiz: { ...quiz, title: input.title },
    modelUsed,
    citations,
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
