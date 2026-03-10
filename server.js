import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

// 1) App
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

/* =========================================================
   Helpers de auditoría
   ========================================================= */

const AuditUserSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    role: { type: String, default: "" }
  },
  { _id: false }
);

function normalizeActor(actor = {}) {
  return {
    userId: typeof actor?.userId === "string" ? actor.userId.trim() : "",
    name: typeof actor?.name === "string" ? actor.name.trim() : "",
    email: typeof actor?.email === "string" ? actor.email.trim() : "",
    role: typeof actor?.role === "string" ? actor.role.trim() : ""
  };
}

/* =========================================================
   Helpers de referencia de hoja membretada
   ========================================================= */

const LetterheadRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: "", index: true },
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
    areaId:
      typeof input?.areaId === "string"
        ? input.areaId.trim()
        : "",
    nombre:
      typeof input?.nombre === "string"
        ? input.nombre.trim()
        : ""
  };
}

function resolveLetterheadRef(body = {}, current = {}) {
  const incomingRef = normalizeLetterheadRef(body.letterheadRef || {});

  return {
    letterheadRef: {
      id: incomingRef.id || current?.letterheadRef?.id || "",
      areaId: incomingRef.areaId || current?.letterheadRef?.areaId || "",
      nombre: incomingRef.nombre || current?.letterheadRef?.nombre || ""
    },
    // Compatibilidad temporal con el front viejo
    letterheadUrl:
      typeof body.letterheadUrl === "string"
        ? body.letterheadUrl.trim()
        : current?.letterheadUrl || ""
  };
}

/* =========================================================
   Modelo (machote)
   - Soft delete con status + fechaBaja/fechaAlta
   - Guardamos SOLO texto en content.text
   - Ignoramos html/json para no almacenar etiquetas
   - Se agrega auditoría de usuario
   - Se agrega referencia formal a hoja membretada
   ========================================================= */

const MachoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    areaKey: { type: String, required: true, index: true },
    area: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "active", "inactive"],
      default: "active",
      index: true
    },

    content: {
      // Fuente de verdad: texto plano
      text: { type: String, default: "" },

      // Compatibilidad de lectura, pero no se persisten con contenido real
      html: { type: String, default: "" },
      json: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // Referencia formal a la hoja membretada
    letterheadRef: { type: LetterheadRefSchema, default: () => ({}) },

    // Compatibilidad temporal
    letterheadUrl: { type: String, default: "" },

    // Auditoría de usuarios
    createdBy: { type: AuditUserSchema, default: () => ({}) },
    updatedBy: { type: AuditUserSchema, default: () => ({}) },
    deactivatedBy: { type: AuditUserSchema, default: () => ({}) },
    reactivatedBy: { type: AuditUserSchema, default: () => ({}) },

    // Auditoría de baja/reactivación
    fechaBaja: { type: Date, default: null },
    fechaAlta: { type: Date, default: null }
  },
  { timestamps: true }
);

const Machote = mongoose.model("Machote", MachoteSchema, "machotes");

// 2) Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Alias para no romper el front
const baseRoutes = ["/machotes", "/templates"];

/* =========================================================
   Helpers de contenido
   ========================================================= */

// Convierte HTML simple a texto plano (sin dependencias)
function htmlToPlainText(html = "") {
  if (!html || typeof html !== "string") return "";

  let text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "- ")
    .replace(/<\/\s*h[1-6]\s*>/gi, "\n");

  // Quita etiquetas restantes
  text = text.replace(/<[^>]*>/g, "");

  // Decodifica entidades comunes
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Limpieza
  text = text.replace(/\r/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

// Resuelve el texto final a guardar:
// - Prioriza incoming.text si viene
// - Si solo viene incoming.html, lo convierte a texto
// - Si no viene nada, usa el texto actual (PUT)
function resolveFinalText(incomingContent = {}, currentContent = {}) {
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
   Routes
   ========================================================= */

baseRoutes.forEach((base) => {
  // Listar
  app.get(base, async (req, res) => {
    try {
      const {
        areaKey = "",
        term = "",
        includeInactive = "false"
      } = req.query;

      const filter = {};
      if (areaKey) filter.areaKey = areaKey;
      if (typeof term === "string" && term.trim()) {
        filter.title = { $regex: term.trim(), $options: "i" };
      }

      // Por defecto excluir inactivos
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
      const doc = await Machote.findById(req.params.id).lean();
      if (!doc) {
        return res.status(404).json({ error: "Machote no encontrado" });
      }
      res.json({ data: doc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Crear
  app.post(base, async (req, res) => {
    try {
      const {
        title,
        areaKey,
        area = "",
        status = "active",
        content = {},
        actor = {}
      } = req.body;

      if (!title?.trim()) {
        return res.status(400).json({ error: "title es requerido" });
      }

      if (!areaKey?.trim()) {
        return res.status(400).json({ error: "areaKey es requerido" });
      }

      const finalText = resolveFinalText(content, {});
      const auditActor = normalizeActor(actor);
      const letterheadData = resolveLetterheadRef(req.body, {});

      const now = new Date();
      const fechaBaja = status === "inactive" ? now : null;
      const fechaAlta = null;

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: {
          text: finalText,
          html: "",
          json: null
        },
        ...letterheadData,
        createdBy: auditActor,
        updatedBy: auditActor,
        deactivatedBy: status === "inactive" ? auditActor : {},
        reactivatedBy: {},
        fechaBaja,
        fechaAlta
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
      const current = await Machote.findById(req.params.id).lean();
      if (!current) {
        return res.status(404).json({ error: "Machote no encontrado" });
      }

      // Whitelist para no aceptar basura
      const allowed = [
        "title",
        "areaKey",
        "area",
        "status",
        "content",
        "letterheadUrl",
        "letterheadRef"
      ];
      const body = {};

      for (const k of allowed) {
        if (k in req.body) body[k] = req.body[k];
      }

      if (typeof body.title === "string") body.title = body.title.trim();
      if (typeof body.areaKey === "string") body.areaKey = body.areaKey.trim();

      const finalText = resolveFinalText(body.content, current.content);
      const auditActor = normalizeActor(req.body.actor || {});
      const letterheadData = resolveLetterheadRef(body, current);

      const nextStatus =
        typeof body.status === "string" ? body.status : current.status;

      const statusPatch = {};
      if (current.status !== nextStatus) {
        if (nextStatus === "inactive") {
          statusPatch.fechaBaja = new Date();
          statusPatch.deactivatedBy = auditActor;
        }

        if (current.status === "inactive" && nextStatus === "active") {
          statusPatch.fechaAlta = new Date();
          statusPatch.reactivatedBy = auditActor;
        }
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            ...body,
            content: {
              text: finalText,
              html: "",
              json: null
            },
            ...letterheadData,
            updatedBy: auditActor,
            ...statusPatch
          }
        },
        { new: true, runValidators: true }
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
      const current = await Machote.findById(req.params.id).lean();
      if (!current) {
        return res.status(404).json({ error: "Machote no encontrado" });
      }

      if (current.status === "inactive") {
        return res.json({
          message: "Machote ya estaba dado de baja",
          data: current
        });
      }

      const auditActor = normalizeActor(req.body.actor || {});

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "inactive",
            fechaBaja: new Date(),
            updatedBy: auditActor,
            deactivatedBy: auditActor
          }
        },
        { new: true, runValidators: true }
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
      const current = await Machote.findById(req.params.id).lean();
      if (!current) {
        return res.status(404).json({ error: "Machote no encontrado" });
      }

      if (current.status === "active") {
        return res.json({
          message: "Machote ya estaba activo",
          data: current
        });
      }

      const auditActor = normalizeActor(req.body.actor || {});

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "active",
            fechaAlta: new Date(),
            updatedBy: auditActor,
            reactivatedBy: auditActor
          }
        },
        { new: true, runValidators: true }
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
      const current = await Machote.findById(req.params.id).lean();
      if (!current) {
        return res.status(404).json({ error: "Machote no encontrado" });
      }

      if (current.status === "inactive") {
        return res.json({
          message: "Machote ya estaba dado de baja",
          data: current
        });
      }

      const auditActor = normalizeActor(req.body.actor || {});

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "inactive",
            fechaBaja: new Date(),
            updatedBy: auditActor,
            deactivatedBy: auditActor
          }
        },
        { new: true, runValidators: true }
      );

      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });
});

// DB + Start
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