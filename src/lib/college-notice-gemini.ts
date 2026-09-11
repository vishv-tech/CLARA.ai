import "server-only";

import type { Interactions } from "@google/genai";
import { runWithModelFallback } from "@/lib/gemini";

export const NOTICE_UNSUPPORTED_ANSWER = "I couldn't find this information in the official college notices.";

const NOTICE_SYSTEM_INSTRUCTION = `You are CLARA's College Notice Agent.
Answer only with information directly supported by the single official college notice File Search store attached to this request.
Never use general knowledge, web search, subject material, personal study sources, or assumptions.
Never invent dates, deadlines, rooms, eligibility rules, fees, schedules, contacts, or instructions.
If the retrieved notice evidence is insufficient, set answerableFromOfficialSources to false.
Keep supported answers concise, clear, and student-friendly.`;

function extractFileCitations(steps: Interactions.Step[] | undefined) {
  const names = new Set<string>();
  for (const step of steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type !== "text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "file_citation" && annotation.file_name) names.add(annotation.file_name);
      }
    }
  }
  return [...names].slice(0, 6);
}

export async function queryCollegeNoticeStore(input: {
  storeName: string;
  question: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
}) {
  const history = input.history
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Student" : "CLARA"}: ${message.text}`)
    .join("\n\n");
  const prompt = `${history ? `Recent notice-only conversation:\n${history}\n\n` : ""}Student question: ${input.question}

Return JSON. Set answerableFromOfficialSources to true only when File Search results from the attached college notice store directly support the answer.`;

  const { value: interaction, modelUsed } = await runWithModelFallback(
    "notice.chat",
    true,
    (client, model, timeoutMs) => client.interactions.create({
      model,
      input: prompt,
      system_instruction: NOTICE_SYSTEM_INSTRUCTION,
      tools: [{ type: "file_search", file_search_store_names: [input.storeName] }],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer", "answerableFromOfficialSources"],
          properties: {
            answer: { type: "string" },
            answerableFromOfficialSources: { type: "boolean" },
          },
        },
      },
      store: false,
    }, { timeout_ms: timeoutMs, retries: { strategy: "none" } }),
  );

  let parsed: { answer?: unknown; answerableFromOfficialSources?: unknown } = {};
  try {
    parsed = JSON.parse(interaction.output_text ?? "{}");
  } catch {
    // Invalid structured output is treated as unsupported, never as permission to guess.
  }
  const sources = extractFileCitations(interaction.steps);
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const supported = parsed.answerableFromOfficialSources === true
    && answer.length > 0
    && sources.length > 0;

  return {
    answer: supported ? answer : NOTICE_UNSUPPORTED_ANSWER,
    answerableFromOfficialSources: supported,
    sources: supported ? sources : [],
    modelUsed,
  };
}
