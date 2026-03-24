import { Documento } from "./models.js";

/* =========================================================
   Helpers de actor / auditoría
   ========================================================= */

export function normalizeActor(actor = {}) {
  return {
    userId:
      typeof actor?.userId === "string"
        ? actor.userId.trim()
        : typeof actor?.uid === "string"
          ? actor.uid.trim()
          : "",
    name: typeof actor?.name === "string" ? actor.name.trim() : "",
    email: typeof actor?.email === "string" ? actor.email.trim() : "",
    role:
      typeof actor?.role === "string"
        ? actor.role.trim()
        : typeof actor?.rol === "string"
          ? actor.rol.trim()
          : ""
  };
}

/* =========================================================
   Helpers de letterhead
   ========================================================= */

export function normalizeLetterheadRef(ref = {}) {
  return {
    id: typeof ref?.id === "string" ? ref.id.trim() : "",
    areaId: typeof ref?.areaId === "string" ? ref.areaId.trim() : "",
    nombre: typeof ref?.nombre === "string" ? ref.nombre.trim() : ""
  };
}

export function resolveLetterheadRef(body = {}, current = {}) {
  return {
    letterheadRef: body.letterheadRef
      ? normalizeLetterheadRef(body.letterheadRef)
      : current?.letterheadRef || {},
    letterheadUrl:
      typeof body.letterheadUrl === "string"
        ? body.letterheadUrl.trim()
        : current?.letterheadUrl || ""
  };
}

/* =========================================================
   Helpers de contenido (machotes)
   ========================================================= */

export function htmlToPlainText(html = "") {
  if (!html || typeof html !== "string") return "";

  let text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "- ")
    .replace(/<\/\s*h[1-6]\s*>/gi, "\n");

  text = text.replace(/<[^>]*>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  text = text.replace(/\r/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export function resolveFinalText(incomingContent = {}, currentContent = {}) {
  const incomingText =
    typeof incomingContent?.text === "string" ? incomingContent.text : "";
  const incomingHtml =
    typeof incomingContent?.html === "string" ? incomingContent.html : "";

  if (incomingText.trim()) return incomingText.trim();
  if (incomingHtml.trim()) return htmlToPlainText(incomingHtml);

  const currentText =
    typeof currentContent?.text === "string" ? currentContent.text : "";

  return currentText || "";
}

/* =========================================================
   Helpers de documentos
   ========================================================= */

export function interpolateText(text = "", campos = {}) {
  if (!text || typeof text !== "string") return "";

  return text.replace(/\[([^\]]+)\]/g, (match, key) => {
    const val = campos[key];
    return val !== undefined && val !== null && String(val).trim() !== ""
      ? String(val).trim()
      : match;
  });
}

export async function generateFolio(areaKey) {
  const year = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const count = await Documento.countDocuments({
    areaKey,
    createdAt: { $gte: start, $lt: end }
  });

  return `${areaKey.toUpperCase()}-${year}-${String(count + 1).padStart(4, "0")}`;
}