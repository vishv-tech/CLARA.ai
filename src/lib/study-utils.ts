import type { StudySource } from "./types";

export const MAX_STUDY_SOURCES = 8;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const STUDY_SOURCE_LIFETIME_MS = 47 * 60 * 60 * 1_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const ACCEPTED_FILE_TYPES = Object.values(MIME_BY_EXTENSION);
export const ACCEPTED_FILE_INPUT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";

export function getSupportedMimeType(fileName: string, reportedMimeType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const inferred = MIME_BY_EXTENSION[extension];
  if (!inferred) return undefined;
  if (!reportedMimeType || reportedMimeType === "application/octet-stream") return inferred;
  return ACCEPTED_FILE_TYPES.includes(reportedMimeType) ? reportedMimeType : undefined;
}

export function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.length > 1;
    if (host === "youtube.com" || host === "m.youtube.com") {
      return Boolean(url.searchParams.get("v")) || /^\/(shorts|live|embed)\/.+/.test(url.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isStudySourceExpired(source: StudySource) {
  if (source.type !== "file") return false;
  const createdAt = new Date(source.createdAt).getTime();
  return source.status !== "ready" || !Number.isFinite(createdAt) || Date.now() - createdAt >= STUDY_SOURCE_LIFETIME_MS;
}
