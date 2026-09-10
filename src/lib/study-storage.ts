import type { StudyMessage, StudySource } from "./types";

const SOURCES_KEY = "sage.study.sources.v1";
const MESSAGES_KEY = "sage.study.messages.v1";
const PREFILL_KEY = "sage.study.prefill.v1";
export const STUDY_DATA_CHANGED_EVENT = "sage:study-data-changed";

function canUseStorage() {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  const stored = window.localStorage.getItem(key);
  if (!stored) return fallback;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(STUDY_DATA_CHANGED_EVENT));
}

export function getStudySources() {
  return readJson<StudySource[]>(SOURCES_KEY, []);
}

export function saveStudySources(sources: StudySource[]) {
  writeJson(SOURCES_KEY, sources);
}

export function getStudyMessages() {
  return readJson<StudyMessage[]>(MESSAGES_KEY, []);
}

export function saveStudyMessages(messages: StudyMessage[]) {
  writeJson(MESSAGES_KEY, messages);
}

export function clearStudyMessages() {
  writeJson<StudyMessage[]>(MESSAGES_KEY, []);
}

export function saveStudyPrefill(prompt: string) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PREFILL_KEY, prompt);
}

export function takeStudyPrefill() {
  if (!canUseStorage()) return "";
  const prompt = window.localStorage.getItem(PREFILL_KEY) ?? "";
  window.localStorage.removeItem(PREFILL_KEY);
  return prompt;
}
