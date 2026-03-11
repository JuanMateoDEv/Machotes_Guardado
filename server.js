import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

/* =========================================================
   Helpers de auditoría
   ========================================================= */

const AuditUserSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    name:   { type: String, default: "" },
    email:  { type: String, default: "" },
    role:   { type: String, default: "" }
  },
  { _id: false }
);

function normalizeActor(actor = {}) {
  return {
    userId: typeof actor?.userId === "string" ? actor.userId.trim() : "",
    name:   typeof actor?.name   === "string" ? actor.name.trim()   : "",
    email:  typeof actor?.email  === "string" ? actor.email.trim()  : "",
    role:   typeof actor?.role   === "string" ? actor.role.trim()   : ""
  };
}

/* =========================================================
   Helpers de referencia de hoja membretada
   ========================================================= */

const LetterheadRefSchema = new mongoose.Schema(
  {
    id:     { type: String, default: "", index: true },
    areaId: { type: String, default: "" },
    nombre: { type: String, default: "" }
  },
  { _id: false }
);

function normalizeLetterheadRef(input = {}) {
  return {
    id:
      typeof input?.id === "string"
        ? input.id.trim()
        : typeof input?._id === "string"
          ? input._id.trim()
          : "",
    areaId: typeof input?.areaId === "string" ? input.areaId.trim() : "",
    nombre: typeof input?.nombre === "string" ? input.nombre.trim() : ""
  };
}

function resolveLetterheadRef(body = {}, current = {}) {
  const incomingRef = normalizeLetterheadRef(body.letterheadRef || {});
  return {
    letterheadRef: {
      id:     incomingRef.id     || current?.letterheadRef?.id     || "",
      areaId: incomingRef.areaId || current?.letterheadRef?.areaId || "",
      nombre: incomingRef.nombre || current?.letterheadRef?.nombre || ""
    },
    letterheadUrl:
      typeof body.letterheadUrl === "string"
        ? body.letterheadUrl.trim()
        : current?.letterheadUrl || ""
  };
}

/* =========================================================
   Modelo: Machote
   ========================================================= */

const MachoteSchema = new mongoose.Schema(
  {
    title:   { type: String, required: true, index: true },
    areaKey: { type: String, required: true, index: true },
    area:    { type: String, default: "" },
    status: {
      type:    String,
      enum:    ["draft", "active", "inactive"],
      default: "active",
      index:   true
    },
    content: {
      text: { type: String, default: "" },
      html: { type: String, default: "" },
      json: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    letterheadRef: { type: LetterheadRefSchema, default: () => ({}) },
    letterheadUrl: { type: String, default: "" },
    createdBy:     { type: AuditUserSchema, default: () => ({}) },
    updatedBy:     { type: AuditUserSchema, default: () => ({}) },
    deactivatedBy: { type: AuditUserSchema, default: () => ({}) },
    reactivatedBy: { type: AuditUserSchema, default: () => ({}) },
    fechaBaja:     { type: Date, default: null },
    fechaAlta:     { type: Date, default: null }
  },
  { timestamps: true }
);

const Machote = mongoose.model("Machote", MachoteSchema, "machotes");

/* =========================================================
   Modelo: Documento
   - Representa el llenado de un machote con datos reales
   - Folio por área: SEC-2026-0001
   - Editable mientras status === "draft"
   - Soft delete con status "cancelado"
   ========================================================= */

const DocumentoSchema = new mongoose.Schema(
  {
    // Referencia al machote que lo originó
    machoteId:    { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Machote", index: true },
    machoteTitle: { type: String, default: "" }, // snapshot por si el machote cambia de título

    // Datos de área (copiados del machote al crear)
    areaKey: { type: String, required: true, index: true },
    area:    { type: String, default: "" },

    // Folio único por área y año: SEC-2026-0001
    folio: { type: String, unique: true, index: true },

    // Valores que el usuario llenó: { "Municipio": "Atotonilco", "Ingresos": "150,000" }
    campos: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Texto final con placeholders ya reemplazados
    contenidoFinal: { type: String, default: "" },

    // Snapshot de la hoja membretada usada al momento de crear
    letterheadRef: { type: LetterheadRefSchema, default: () => ({}) },
    letterheadUrl: { type: String, default: "" },

    // borrador = en proceso, final = cerrado/inmutable, cancelado = baja lógica
    status: {
      type:    String,
      enum:    ["borrador", "final", "cancelado"],
      default: "borrador",
      index:   true
    },

    // Auditoría
    createdBy:   { type: AuditUserSchema, default: () => ({}) },
    updatedBy:   { type: AuditUserSchema, default: () => ({}) },
    canceladoPor: { type: AuditUserSchema, default: () => ({}) },
    fechaCancelado: { type: Date, default: null }
  },
  { timestamps: true }
);

const Documento = mongoose.model("Documento", DocumentoSchema, "documentos");

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/* =========================================================
   Helpers de contenido (machotes)
   ========================================================= */

function htmlToPlainText(html = "") {
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

function resolveFinalText(incomingContent = {}, currentContent = {}) {
  const incomingText = typeof incomingContent?.text === "string" ? incomingContent.text : "";
  const incomingHtml = typeof incomingContent?.html === "string" ? incomingContent.html : "";
  if (incomingText.trim()) return incomingText.trim();
  if (incomingHtml.trim()) return htmlToPlainText(incomingHtml);
  const currentText = typeof currentContent?.text === "string" ? currentContent.text : "";
  return currentText || "";
}

/* =========================================================
   Helpers de documentos
   ========================================================= */

/**
 * Reemplaza [Placeholder] en el texto con los valores del objeto campos.
 * Ejemplo: interpolateText("Hola [Nombre]", { Nombre: "Juan" }) → "Hola Juan"
 * Placeholders sin valor en campos se dejan como están.
 */
function interpolateText(text = "", campos = {}) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\[([^\]]+)\]/g, (match, key) => {
    const val = campos[key];
    return val !== undefined && val !== null && String(val).trim() !== ""
      ? String(val).trim()
      : match; // si no hay valor, deja el placeholder
  });
}

/**
 * Genera folio único por área y año.
 * Formato: {areaKey}-{año}-{numero 4 dígitos}
 * Ejemplo: SEC-2026-0001
 *
 * Usa countDocuments para calcular el siguiente número.
 * NOTA: En alta concurrencia podría haber colisiones; para ese caso
 * se recomienda una colección de contadores con findOneAndUpdate + $inc.
 */
async function generateFolio(areaKey) {
  const year  = new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end   = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const count = await Documento.countDocuments({
    areaKey,
    createdAt: { $gte: start, $lt: end }
  });

  return `${areaKey.toUpperCase()}-${year}-${String(count + 1).padStart(4, "0")}`;
}

/* =========================================================
   Rutas: Machotes (sin cambios respecto a tu código original)
   ========================================================= */

const baseRoutes = ["/machotes", "/templates"];

baseRoutes.forEach((base) => {
  // Listar
  app.get(base, async (req, res) => {
    try {
      const { areaKey = "", term = "", includeInactive = "false" } = req.query;
      const filter = {};
      if (areaKey) filter.areaKey = areaKey;
      if (typeof term === "string" && term.trim()) {
        filter.title = { $regex: term.trim(), $options: "i" };
      }
      if (includeInactive !== "true") {
        filter.status = { $ne: "inactive" };
      }
      const items = await Machote.find(filter).sort({ updatedAt: -1 }).lean();
      res.json({ items });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Obtener 1
  app.get(`${base}/:id`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const doc = await Machote.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: "Machote no encontrado" });
      res.json({ data: doc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Crear
  app.post(base, async (req, res) => {
    try {
      const { title, areaKey, area = "", status = "active", content = {}, actor = {} } = req.body;
      if (!title?.trim())   return res.status(400).json({ error: "title es requerido" });
      if (!areaKey?.trim()) return res.status(400).json({ error: "areaKey es requerido" });

      const finalText      = resolveFinalText(content, {});
      const auditActor     = normalizeActor(actor);
      const letterheadData = resolveLetterheadRef(req.body, {});
      const now            = new Date();

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: { text: finalText, html: "", json: null },
        ...letterheadData,
        createdBy:     auditActor,
        updatedBy:     auditActor,
        deactivatedBy: status === "inactive" ? auditActor : {},
        reactivatedBy: {},
        fechaBaja:     status === "inactive" ? now : null,
        fechaAlta:     null
      });

      res.status(201).json({ message: "Machote creado", data: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Actualizar
  app.put(`${base}/:id`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      const allowed = ["title", "areaKey", "area", "status", "content", "letterheadUrl", "letterheadRef"];
      const body = {};
      for (const k of allowed) { if (k in req.body) body[k] = req.body[k]; }
      if (typeof body.title   === "string") body.title   = body.title.trim();
      if (typeof body.areaKey === "string") body.areaKey = body.areaKey.trim();

      const finalText      = resolveFinalText(body.content, current.content);
      const auditActor     = normalizeActor(req.body.actor || {});
      const letterheadData = resolveLetterheadRef(body, current);
      const nextStatus     = typeof body.status === "string" ? body.status : current.status;

      const statusPatch = {};
      if (current.status !== nextStatus) {
        if (nextStatus === "inactive") {
          statusPatch.fechaBaja      = new Date();
          statusPatch.deactivatedBy  = auditActor;
        }
        if (current.status === "inactive" && nextStatus === "active") {
          statusPatch.fechaAlta     = new Date();
          statusPatch.reactivatedBy = auditActor;
        }
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { ...body, content: { text: finalText, html: "", json: null }, ...letterheadData, updatedBy: auditActor, ...statusPatch } },
        { returnDocument: "after", runValidators: true }
      );

      res.json({ message: "Machote actualizado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Dar de baja
  app.post(`${base}/:id/deactivate`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });
      if (current.status === "inactive") {
        return res.json({ message: "Machote ya estaba dado de baja", data: current });
      }
      const auditActor = normalizeActor(req.body.actor || {});
      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "inactive", fechaBaja: new Date(), updatedBy: auditActor, deactivatedBy: auditActor } },
        { returnDocument: "after", runValidators: true }
      );
      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Reactivar
  app.post(`${base}/:id/reactivate`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });
      if (current.status === "active") {
        return res.json({ message: "Machote ya estaba activo", data: current });
      }
      const auditActor = normalizeActor(req.body.actor || {});
      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "active", fechaAlta: new Date(), updatedBy: auditActor, reactivatedBy: auditActor } },
        { returnDocument: "after", runValidators: true }
      );
      res.json({ message: "Machote reactivado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // DELETE como baja lógica
  app.delete(`${base}/:id`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });
      if (current.status === "inactive") {
        return res.json({ message: "Machote ya estaba dado de baja", data: current });
      }
      const auditActor = normalizeActor(req.body.actor || {});
      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "inactive", fechaBaja: new Date(), updatedBy: auditActor, deactivatedBy: auditActor } },
        { returnDocument: "after", runValidators: true }
      );
      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });
});

/* =========================================================
   Rutas: Documentos
   ========================================================= */

// GET /documentos — historial de documentos llenados
// Query params: machoteId, areaKey, status, term (busca en folio), page, limit
app.get("/documentos", async (req, res) => {
  try {
    const {
      machoteId    = "",
      areaKey      = "",
      status       = "",
      term         = "",
      page         = "1",
      limit        = "20"
    } = req.query;

    const filter = {};

    if (machoteId && mongoose.isValidObjectId(machoteId)) {
      filter.machoteId = machoteId;
    }
    if (areaKey) filter.areaKey = areaKey;
    if (status)  filter.status  = status;
    else         filter.status  = { $ne: "cancelado" }; // excluir cancelados por defecto

    if (typeof term === "string" && term.trim()) {
      filter.folio = { $regex: term.trim(), $options: "i" };
    }

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Documento.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Documento.countDocuments(filter)
    ]);

    res.json({
      items,
      pagination: {
        total,
        page:  pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

// GET /documentos/:id — obtener un documento
app.get("/documentos/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const doc = await Documento.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    res.json({ data: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

// POST /documentos — crear un documento llenado a partir de un machote
// Body esperado:
// {
//   machoteId: "...",
//   campos: { "Municipio": "Atotonilco", "Ingresos": "150,000", "Egresos": "120,000" },
//   status: "draft" | "final",   (opcional, default: "draft")
//   actor: { userId, name, email, role }
// }
app.post("/documentos", async (req, res) => {
  try {
    const { machoteId, campos = {}, status = "borrador", actor = {} } = req.body;

    // Validaciones
    if (!machoteId) {
      return res.status(400).json({ error: "machoteId es requerido" });
    }
    if (!mongoose.isValidObjectId(machoteId)) {
      return res.status(400).json({ error: "machoteId inválido" });
    }
    if (!["borrador", "final"].includes(status)) {
      return res.status(400).json({ error: "status debe ser borrador o final" });
    }

    // Verificar que el machote existe y está activo
    const machote = await Machote.findById(machoteId).lean();
    if (!machote) {
      return res.status(404).json({ error: "Machote no encontrado" });
    }
    if (machote.status === "inactive") {
      return res.status(400).json({ error: "No se puede crear un documento de un machote inactivo" });
    }

    // Generar folio y texto interpolado
    const folio          = await generateFolio(machote.areaKey);
    const contenidoFinal = interpolateText(machote.content?.text || "", campos);
    const auditActor     = normalizeActor(actor);

    const created = await Documento.create({
      machoteId,
      machoteTitle:   machote.title,
      areaKey:        machote.areaKey,
      area:           machote.area,
      folio,
      campos,
      contenidoFinal,
      // Snapshot de la hoja membretada al momento de crear
      letterheadRef:  machote.letterheadRef  || {},
      letterheadUrl:  machote.letterheadUrl  || "",
      status,
      createdBy:      auditActor,
      updatedBy:      auditActor,
      canceladoPor:   {},
      fechaCancelado: null
    });

    res.status(201).json({ message: "Documento creado", data: created });
  } catch (err) {
    // Folio duplicado (raro pero posible en concurrencia)
    if (err.code === 11000) {
      return res.status(409).json({ error: "Folio duplicado, intenta de nuevo" });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

// PUT /documentos/:id — editar un documento (solo si está en draft)
// Body esperado:
// {
//   campos: { "Municipio": "Nuevo valor", ... },   (opcional)
//   status: "draft" | "final",                     (opcional, para cerrar el documento)
//   actor: { userId, name, email, role }
// }
app.put("/documentos/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const current = await Documento.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Documento no encontrado" });

    // Solo se puede editar si está en draft
    if (current.status !== "borrador") {
      return res.status(400).json({
        error: `El documento no se puede editar porque su status es "${current.status}"`
      });
    }

    const { campos, status, actor = {} } = req.body;
    const auditActor = normalizeActor(actor);

    // Validar status si viene
    if (status && !["borrador", "final"].includes(status)) {
      return res.status(400).json({ error: "status debe ser borrador o final" });
    }

    // Recalcular contenido si cambian los campos
    const nextCampos = campos && typeof campos === "object"
      ? { ...current.campos, ...campos } // merge: conserva campos no enviados
      : current.campos;

    // Necesitamos el texto base del machote para re-interpolar
    const machote = await Machote.findById(current.machoteId).lean();
    const contenidoFinal = machote
      ? interpolateText(machote.content?.text || "", nextCampos)
      : current.contenidoFinal; // fallback si el machote fue eliminado

    const updated = await Documento.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          campos:         nextCampos,
          contenidoFinal,
          status:         status || current.status,
          updatedBy:      auditActor
        }
      },
      { returnDocument: "after", runValidators: true }
    );

    res.json({ message: "Documento actualizado", data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

// DELETE /documentos/:id — baja lógica (status: cancelado)
app.delete("/documentos/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const current = await Documento.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Documento no encontrado" });

    if (current.status === "cancelado") {
      return res.json({ message: "Documento ya estaba cancelado", data: current });
    }

    const auditActor = normalizeActor(req.body.actor || {});

    const updated = await Documento.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status:         "cancelado",
          fechaCancelado: new Date(),
          updatedBy:      auditActor,
          canceladoPor:   auditActor
        }
      },
      { returnDocument: "after", runValidators: true }
    );

    res.json({ message: "Documento cancelado", data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

/* =========================================================
   DB + Start
   ========================================================= */

const port = process.env.PORT || 5055;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME || "maprise"
  });
  console.log("Mongo conectado (db:", process.env.DB_NAME || "maprise", ")");
  app.listen(port, () => {
    console.log(`Microservice running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("Error al iniciar:", err);
  process.exit(1);
});