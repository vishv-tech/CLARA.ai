import "server-only";

import { ApiError, GoogleGenAI, type Interactions } from "@google/genai";
import { normalizeQuizPayload } from "./quiz-utils";
import type { QuizDifficulty, StudyMessage, StudyMode, StudySource, WebCitation } from "./types";

const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"] as const;
export type GeminiModel = (typeof MODELS)[number];
const PRIMARY_ATTEMPT_TIMEOUT_MS = 15_000;
const FALLBACK_ATTEMPT_TIMEOUT_MS = 42_000;
const GOOGLE_SEARCH_TOOL = { type: "google_search" } as const satisfies Interactions.Tool;

const SYSTEM_INSTRUCTION = `You are SAGE, Smart Agentic Guidance Engine, an academic assistant for college students.
Help students understand concepts with clear reasoning and learning support. When course sources are supplied, prioritize them and never claim a detail came from a source unless it is actually supported. Clearly say when the supplied material is insufficient. General knowledge may be used for explanation, but distinguish it from source-supported information. When web search is enabled, distinguish current web information. Never fabricate source names, page numbers, citations, or timestamps. Use readable Markdown with concise headings and lists when useful.`;

type InteractionContent =
  | { type: "text"; text: string }
  | { type: "document"; uri: string; mime_type: string }
  | { type: "image"; uri: string; mime_type: string }
  | { type: "video"; uri: string };

export class GeminiConfigurationError extends Error {}
export class GeminiSourceError extends Error {}
export class GeminiUnavailableError extends Error {}
export class GeminiQuizFormatError extends Error {}

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiConfigurationError("SAGE AI is not configured yet. Add GEMINI_API_KEY to .env.local.");
  return new GoogleGenAI({ apiKey });
}

function getErrorStatus(error: unknown) {
  if (error instanceof ApiError) return error.status;
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isRetriable(error: unknown) {
  const status = getErrorStatus(error);
  if (status !== undefined) return status === 429 || status >= 500;
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    return name.includes("timeout") || name.includes("abort") || message.includes("network") || message.includes("fetch failed") || message.includes("temporarily unavailable");
  }
  return false;
}

export async function runWithModelFallback<T>(
  operation: "study.chat" | "study.explore" | "quiz.generate" | "quiz.recommend" | "subject.chat",
  hasSources: boolean,
  request: (client: GoogleGenAI, model: GeminiModel, timeoutMs: number) => Promise<T>,
) {
  const client = getGeminiClient();
  for (const [index, model] of MODELS.entries()) {
    try {
      const timeoutMs = index === 0 ? PRIMARY_ATTEMPT_TIMEOUT_MS : FALLBACK_ATTEMPT_TIMEOUT_MS;
      const value = await request(client, model, timeoutMs);
      console.info(`[SAGE AI] ${operation} -> ${model}`);
      return { value, modelUsed: model };
    } catch (error) {
      const status = getErrorStatus(error);
      if (status === 404 && hasSources) {
        throw new GeminiSourceError("One of these sources has expired and needs to be uploaded again.");
      }
      if (!isRetriable(error)) throw error;
      if (index < MODELS.length - 1) {
        const reason = status !== undefined ? `HTTP ${status}` : error instanceof Error ? error.name : "unknown error";
        console.warn(`[SAGE AI] ${model} failed with a retriable ${reason}; trying fallback.`);
        continue;
      }
      throw new GeminiUnavailableError("SAGE AI is temporarily busy. Please try again.");
    }
  }
  throw new GeminiUnavailableError("SAGE AI is temporarily busy. Please try again.");
}

function safeErrorSummary(error: unknown) {
  const status = getErrorStatus(error);
  if (error instanceof Error && status !== undefined) return `${error.name} (HTTP ${status})`;
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
}

function buildPrompt(message: string, history: StudyMessage[], mode: StudyMode, sourceNames: string[]) {
  const recentHistory = history.slice(-8).map((item) => `${item.role === "user" ? "Student" : "SAGE"}: ${item.text}`).join("\n\n");
  const contextNote = mode === "course"
    ? sourceNames.length
      ? `Active course sources: ${sourceNames.join(", ")}. Answer primarily from these sources. If they do not contain enough information, say so before adding clearly-labelled general explanation.`
      : "No course source is attached. Answer as a general academic assistant and clearly note that no student source was available."
    : "Explore Mode is active. Use Google Search when it improves recency or accuracy and distinguish web-supported information.";

  return `${contextNote}${recentHistory ? `\n\nRecent conversation:\n${recentHistory}` : ""}\n\nCurrent student question:\n${message}`;
}

function sourceToContent(source: StudySource): InteractionContent | undefined {
  if (source.type === "youtube" && source.url) return { type: "video", uri: source.url };
  if (!source.geminiUri || !source.mimeType) return undefined;
  if (source.mimeType.startsWith("image/")) return { type: "image", uri: source.geminiUri, mime_type: source.mimeType };
  return { type: "document", uri: source.geminiUri, mime_type: source.mimeType };
}

function extractCitations(steps: Interactions.Step[] | undefined): WebCitation[] {
  const citations = new Map<string, WebCitation>();
  for (const step of steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type !== "text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          let fallbackTitle = "Web source";
          try {
            fallbackTitle = new URL(annotation.url).hostname;
          } catch {
            // Keep the safe generic label if the provider returns a malformed URL.
          }
          citations.set(annotation.url, { title: annotation.title || fallbackTitle, url: annotation.url });
        }
      }
    }
  }
  return Array.from(citations.values()).slice(0, 6);
}

export async function uploadStudyFile(file: File, mimeType: string) {
  const client = getGeminiClient();
  let uploaded = await client.files.upload({
    file,
    config: {
      mimeType,
      displayName: file.name,
      abortSignal: AbortSignal.timeout(FALLBACK_ATTEMPT_TIMEOUT_MS),
    },
  });

  for (let check = 0; uploaded.state === "PROCESSING" && check < 12; check += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (!uploaded.name) break;
    uploaded = await client.files.get({ name: uploaded.name });
  }

  if (uploaded.state === "FAILED" || uploaded.state === "PROCESSING" || !uploaded.name || !uploaded.uri) {
    throw new Error("That source could not be processed. Try uploading it again.");
  }

  return {
    geminiFileName: uploaded.name,
    geminiUri: uploaded.uri,
    mimeType: uploaded.mimeType || mimeType,
  };
}

export async function askGemini(input: {
  message: string;
  mode: StudyMode;
  sources: StudySource[];
  history: StudyMessage[];
}) {
  const activeSources = input.mode === "course" ? input.sources.filter((source) => source.status === "ready") : [];
  const sourceNames = activeSources.map((source) => source.name);
  const media = activeSources.map(sourceToContent).filter((item): item is InteractionContent => Boolean(item));
  const prompt = buildPrompt(input.message, input.history, input.mode, sourceNames);

  const operation = input.mode === "explore" ? "study.explore" : "study.chat";
  let interactionResult;
  try {
    interactionResult = await runWithModelFallback(operation, activeSources.length > 0, (client, model, timeoutMs) =>
      client.interactions.create({
        model,
        input: input.mode === "explore" ? prompt : [...media, { type: "text", text: prompt }],
        system_instruction: SYSTEM_INSTRUCTION,
        store: false,
        tools: input.mode === "explore" ? [GOOGLE_SEARCH_TOOL] : undefined,
      }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
    );
  } catch (error) {
    if (input.mode === "explore") console.error(`[SAGE AI] study.explore failed: ${safeErrorSummary(error)}`);
    throw error;
  }
  const { value: interaction, modelUsed } = interactionResult;

  const text = interaction.output_text?.trim();
  if (!text) throw new Error("SAGE AI returned an empty response.");
  return {
    text,
    modelUsed,
    contextSources: sourceNames,
    webSearchUsed: interaction.steps?.some((step) => step.type === "google_search_call" || step.type === "google_search_result") ?? false,
    citations: extractCitations(interaction.steps),
  };
}

function quizResponseFormat(difficulty: QuizDifficulty, questionCount: 5 | 10) {
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
              options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" },
              },
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

export async function generateQuiz(input: {
  difficulty: QuizDifficulty;
  questionCount: 5 | 10;
  sources: StudySource[];
  topic?: string;
}) {
  const activeSources = input.sources.filter((source) => source.status === "ready");
  const sourceIds = activeSources.map((source) => source.id);
  const sourceNames = activeSources.map((source) => source.name);
  const media = activeSources.map(sourceToContent).filter((item): item is InteractionContent => Boolean(item));
  const basis = sourceNames.length
    ? `Use only the supplied academic sources: ${sourceNames.join(", ")}. Do not invent unsupported facts.`
    : `Create the quiz about this academic topic: ${input.topic?.trim()}.`;
  const prompt = `Generate exactly ${input.questionCount} ${input.difficulty} multiple-choice questions. ${basis}
Easy means foundational recall and understanding. Medium means concepts and moderate application. Hard means deeper reasoning, scenarios, and conceptual distinctions.
Each question must test understanding, have exactly four distinct plausible options, one correct option index from 0 to 3, a concise topic label, and a short learning explanation. Return only the requested structured JSON.`;

  const { value: interaction, modelUsed } = await runWithModelFallback("quiz.generate", activeSources.length > 0, (client, model, timeoutMs) =>
    client.interactions.create({
      model,
      input: [...media, { type: "text", text: prompt }],
      system_instruction: "You are SAGE's academic quiz generator. Create accurate, unambiguous MCQs that respect the requested material and difficulty.",
      response_format: quizResponseFormat(input.difficulty, input.questionCount),
      store: false,
    }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
  );

  const output = interaction.output_text?.trim();
  if (!output) throw new GeminiQuizFormatError("SAGE could not create a complete quiz. Please try again.");
  let payload: unknown;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new GeminiQuizFormatError("SAGE returned an incomplete quiz. Please try again.");
  }
  const quiz = normalizeQuizPayload(payload, input.difficulty, input.questionCount, sourceIds, sourceNames);
  if (!quiz) throw new GeminiQuizFormatError("SAGE returned an incomplete quiz. Please try again.");
  return { quiz, modelUsed };
}

export async function generateQuizRecommendation(input: {
  title: string;
  difficulty: QuizDifficulty;
  percentage: number;
  weakTopics: string[];
  developingTopics: string[];
  strongTopics: string[];
}) {
  const prompt = `Write a supportive revision recommendation in 2-3 short sentences.
Quiz: ${input.title}
Difficulty: ${input.difficulty}
Score: ${input.percentage}%
Weak topics: ${input.weakTopics.join(", ") || "None"}
Developing topics: ${input.developingTopics.join(", ") || "None"}
Strong topics: ${input.strongTopics.join(", ") || "None"}
Prioritize what to revise next and give one practical study action. Do not recalculate or dispute the score.`;
  const { value: interaction, modelUsed } = await runWithModelFallback("quiz.recommend", false, (client, model, timeoutMs) =>
    client.interactions.create({
      model,
      input: prompt,
      system_instruction: "You are SAGE, a concise and encouraging academic revision coach.",
      store: false,
    }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
  );
  const text = interaction.output_text?.trim();
  if (!text) throw new Error("SAGE returned an empty recommendation.");
  return { text: text.slice(0, 800), modelUsed };
}

export function geminiErrorResponse(error: unknown) {
  if (error instanceof GeminiConfigurationError) return { status: 503, code: "NOT_CONFIGURED", message: error.message };
  if (error instanceof GeminiSourceError) return { status: 410, code: "SOURCE_EXPIRED", message: error.message };
  if (error instanceof GeminiUnavailableError) return { status: 503, code: "AI_UNAVAILABLE", message: error.message };
  if (error instanceof GeminiQuizFormatError) return { status: 502, code: "QUIZ_FORMAT", message: error.message };
  if (getErrorStatus(error) === 429) return { status: 503, code: "RATE_LIMITED", message: "SAGE AI is temporarily busy. Please try again." };
  return { status: 500, code: "AI_ERROR", message: "SAGE could not complete that request. Please try again." };
}
