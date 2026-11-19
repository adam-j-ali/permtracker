/**
 * Document management constants and types.
 *
 * Canonical source — frontend re-exports from src/lib/documents/.
 */

/** Allowed file extensions for document upload (whitelist approach per OWASP file upload guidance). */
export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "tiff",
  "tif",
]);

/** Allowed MIME types for document upload. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

/** Maximum file size in bytes (20 MB). */
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

/** Maximum number of documents per case. */
export const MAX_DOCUMENTS_PER_CASE = 50;

/** What the upload refusal says, on the server and before an upload starts. */
export const DOCUMENT_CAP_MESSAGE = `${MAX_DOCUMENTS_PER_CASE} documents is the most a case can hold. Delete one to add another.`;

/**
 * How long after an upload its file can be attached to a case: the life of the upload address
 * (`generateUploadUrl`), an hour. Past it, a file id names someone's saved document, and an id that leaked (a shared
 * export holds them) must never let another account attach, open or delete it.
 */
export const UPLOAD_CLAIM_WINDOW_MS = 60 * 60 * 1000;

/** What an attach of a missing, unreadable or expired upload is told. */
export const UPLOAD_GONE_MESSAGE = "That upload wasn't found or has expired. Add the file again.";

/** What a case write that names a file the case doesn't hold is told. */
export const DOCUMENTS_THROUGH_UPLOAD_MESSAGE = "Documents are added by uploading them to the case.";

/**
 * The file ids a new document list names that the case doesn't already hold. A case's list may drop, rename or
 * reorder its own files; a new file comes in only through `documents.saveDocument`, which checks the upload. Deleting
 * a case deletes every file its list names, so a planted id would delete someone else's document.
 */
export function filesNotHeld(
  held: readonly { storageId?: string }[] | undefined,
  next: readonly { storageId?: string }[],
): string[] {
  const own = new Set((held ?? []).map((d) => d.storageId).filter((id): id is string => Boolean(id)));
  return next.map((d) => d.storageId).filter((id): id is string => Boolean(id) && !own.has(id!));
}

/** Maximum display name length for document filenames. */
export const MAX_DOCUMENT_NAME_LENGTH = 255;

/** PERM document categories. */
export const DOCUMENT_CATEGORIES = [
  "pwd",
  "recruitment",
  "eta9089",
  "i140",
  "general",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Human-readable labels for document categories. */
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  pwd: "PWD",
  recruitment: "Recruitment",
  eta9089: "ETA-9089",
  i140: "I-140",
  general: "General",
};
