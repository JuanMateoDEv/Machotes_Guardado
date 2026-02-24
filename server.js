import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

// 1) App
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

/* =========================================================
   Modelo (machote)
   - Soft delete con status + fechaBaja/fechaAlta
   - Contenido plano en content.text (recomendado)
   - Compatibilidad: content.html/json (no rompe)
   - NO guardamos variables (se ignoran para evitar metadata extra)
   ========================================================= */

const MachoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    areaKey: { type: String, required: true, index: true }, // RH, TES...
    area: { type: String, default: "" },
    status: { type: String, enum: ["draft", "active", "inactive"], default: "active", index: true },

    content: {
      // ✅ Recomendado: texto plano
      text: { type: String, default: "" },

      // Compatibilidad con tu front actual (si todavía usa html/json)
      html: { type: String, default: "" },
      json: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // Hoja membretada
    letterheadUrl: { type: String, default: "" },

    // ✅ Auditoría: SOLO cambian cuando cambia status
    fechaBaja: { type: Date, default: null },
    fechaAlta: { type: Date, default: null }
  },
  { timestamps: true }
);

// Fuerza nombre de colección EXACTO: "machotes"
const Machote = mongoose.model("Machote", MachoteSchema, "machotes");

// 2) Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Helpers:
 * Permitimos usar /machotes (nuevo) y /templates (alias)
 * para que tu front no se rompa.
 */
const baseRoutes = ["/machotes", "/templates"];

/* =========================================================
   Helpers mínimos
   ========================================================= */

// Resuelve content final sin romper compat:
// - si llega content.text lo usamos
// - si llega content.html lo usamos
// - si no llega, usamos lo actual (en PUT)
function resolveFinalContent(incomingContent = {}, currentContent = {}) {
  const text =
    typeof incomingContent?.text === "string"
      ? incomingContent.text
      : typeof currentContent?.text === "string"
        ? currentContent.text
        : "";

  const html =
    typeof incomingContent?.html === "string"
      ? incomingContent.html
      : typeof currentContent?.html === "string"
        ? currentContent.html
        : "";

  const json =
    incomingContent?.json !== undefined ? incomingContent.json : (currentContent?.json ?? null);

  return { text, html, json };
}

/* =========================================================
   Routes
   ========================================================= */

baseRoutes.forEach((base) => {
  // 3) Listar machotes
  // GET /machotes?areaKey=RH&term=constancia&includeInactive=true|false
  app.get(base, async (req, res) => {
    try {
      const { areaKey = "", term = "", includeInactive = "false" } = req.query;

      const filter = {};
      if (areaKey) filter.areaKey = areaKey;
      if (term.trim()) filter.title = { $regex: term.trim(), $options: "i" };

      // ✅ Por defecto, excluir inactivos
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

  // 4) Obtener 1 machote
  app.get(`${base}/:id`, async (req, res) => {
    try {
      const doc = await Machote.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: "Machote no encontrado" });
      res.json({ data: doc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 5) Crear machote
  app.post(base, async (req, res) => {
    try {
      const {
        title,
        areaKey,
        area = "",
        status = "active",
        content = {},
        // variables se ignora (ya no guardamos metadatos extra)
        letterheadUrl = ""
      } = req.body;

      if (!title?.trim()) return res.status(400).json({ error: "title es requerido" });
      if (!areaKey?.trim()) return res.status(400).json({ error: "areaKey es requerido" });

      const finalContent = resolveFinalContent(content, {});

      // Auditoría inicial (solo si lo crean ya inactivo)
      const now = new Date();
      const fechaBaja = status === "inactive" ? now : null;
      const fechaAlta = null;

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: {
          text: finalContent.text || "",
          html: finalContent.html || "",
          json: finalContent.json ?? null
        },
        letterheadUrl,
        fechaBaja,
        fechaAlta
      });

      res.status(201).json({ message: "Machote creado", data: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 6) Actualizar machote
  app.put(`${base}/:id`, async (req, res) => {
    try {
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      // ✅ Whitelist de campos permitidos (evita romper cosas)
      const allowed = ["title", "areaKey", "area", "status", "content", "letterheadUrl"];
      const body = {};
      for (const k of allowed) if (k in req.body) body[k] = req.body[k];

      // Normaliza strings
      if (typeof body.title === "string") body.title = body.title.trim();
      if (typeof body.areaKey === "string") body.areaKey = body.areaKey.trim();

      // Content final (prefer text si viene)
      const finalContent = resolveFinalContent(body.content, current.content);

      // ✅ Fechas de baja/alta SOLO cuando cambia status
      const nextStatus = typeof body.status === "string" ? body.status : current.status;

      const statusPatch = {};
      if (current.status !== nextStatus) {
        if (nextStatus === "inactive") {
          statusPatch.fechaBaja = new Date();
        }
        if (current.status === "inactive" && nextStatus === "active") {
          statusPatch.fechaAlta = new Date();
        }
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            ...body,
            content: {
              text: finalContent.text || "",
              html: finalContent.html || "",
              json: finalContent.json ?? null
            },
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

  /* =========================================================
     ✅ Soft delete: dar de baja / reactivar
     ========================================================= */

  // 7) Dar de baja
  app.post(`${base}/:id/deactivate`, async (req, res) => {
    try {
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      // Si ya está inactive, no sobreescribir fechaBaja
      if (current.status === "inactive") {
        return res.json({ message: "Machote ya estaba dado de baja", data: current });
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "inactive", fechaBaja: new Date() } },
        { new: true, runValidators: true }
      );

      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 8) Reactivar
  app.post(`${base}/:id/reactivate`, async (req, res) => {
    try {
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      // Si ya está active, no sobreescribir fechaAlta
      if (current.status === "active") {
        return res.json({ message: "Machote ya estaba activo", data: current });
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "active", fechaAlta: new Date() } },
        { new: true, runValidators: true }
      );

      res.json({ message: "Machote reactivado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 9) DELETE ahora es BAJA (para no romper el front)
  app.delete(`${base}/:id`, async (req, res) => {
    try {
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      if (current.status === "inactive") {
        return res.json({ message: "Machote ya estaba dado de baja", data: current });
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: { status: "inactive", fechaBaja: new Date() } },
        { new: true, runValidators: true }
      );

      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });
});

// 10) DB + Start
const port = process.env.PORT || 5055;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME || "maprise"
  });

  console.log("✅ Mongo conectado (db:", process.env.DB_NAME || "maprise", ")");
  app.listen(port, () => console.log(`Microservice running on http://localhost:${port}`));
}

main().catch((err) => {
  console.error("Error al iniciar:", err);
  process.exit(1);
});