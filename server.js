import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

// 1) App
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

// 2) Modelo (machote)
const MachoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    areaKey: { type: String, required: true, index: true }, // RH, TES...
    area: { type: String, default: "" }, // "Recursos Humanos"
    status: { type: String, enum: ["draft", "active", "inactive"], default: "active" },

    // Guarda el contenido del editor (elige HTML o JSON)
    content: {
      html: { type: String, default: "" },
      json: { type: mongoose.Schema.Types.Mixed, default: null }
    },

    // Para mostrar "Variables: 7"
    variables: {
      type: [
        {
          key: { type: String, required: true },
          label: { type: String, default: "" },
          type: { type: String, default: "string" },
          required: { type: Boolean, default: false }
        }
      ],
      default: []
    },

    // La hoja membretada (solo URL)
    letterheadUrl: { type: String, default: "" }
  },
  { timestamps: true }
);

// Fuerza nombre de colección EXACTO: "machotes"
const Machote = mongoose.model("Machote", MachoteSchema, "machotes");

// 3) Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Helpers:
 * Permitimos usar /machotes (nuevo) y /templates (alias)
 * para que tu front no se rompa.
 */
const baseRoutes = ["/machotes", "/templates"];

/* =========================================================
   ✅ NUEVO: Helpers para detectar y fusionar variables [..]
   ========================================================= */

function extractBracketVariables(html = "") {
  // Captura [Algo] sin permitir corchetes internos (no anidados)
  const re = /\[([^\[\]]+)\]/g;
  const set = new Set();
  let m;

  while ((m = re.exec(html)) !== null) {
    const key = (m[1] || "").trim();
    if (key) set.add(key);
  }

  return [...set].map((key) => ({
    key,
    label: key,
    type: "string",
    required: false
  }));
}

function normalizeVariables(list = []) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (!v?.key) continue;
    const key = String(v.key).trim();
    if (!key) continue;

    out.push({
      key,
      label: (v.label ?? "").toString(),
      type: (v.type ?? "string").toString(),
      required: Boolean(v.required)
    });
  }
  return out;
}

/**
 * existing tiene prioridad (preserva label/type/required)
 * detected solo agrega las que no existían.
 * NO borramos variables aunque ya no estén en el HTML.
 */
function mergeVariables(existing = [], detected = []) {
  const map = new Map();

  for (const v of normalizeVariables(existing)) {
    map.set(v.key, v);
  }

  for (const v of normalizeVariables(detected)) {
    if (!map.has(v.key)) map.set(v.key, v);
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ========================================================= */

// 4) Listar machotes
// GET /machotes?areaKey=RH&term=constancia
// GET /templates?areaKey=RH&term=constancia  (alias)
baseRoutes.forEach((base) => {
  app.get(base, async (req, res) => {
    try {
      const { areaKey = "", term = "" } = req.query;

      const filter = {};
      if (areaKey) filter.areaKey = areaKey;
      if (term.trim()) filter.title = { $regex: term.trim(), $options: "i" };

      const items = await Machote.find(filter).sort({ updatedAt: -1 }).lean();

      const mapped = items.map((t) => ({
        ...t,
        variablesCount: t.variables?.length || 0
      }));

      res.json({ items: mapped });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 5) Obtener 1 machote
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

  // 6) Crear machote
  app.post(base, async (req, res) => {
    try {
      const {
        title,
        areaKey,
        area = "",
        status = "active",
        content = {},
        variables = [],
        letterheadUrl = ""
      } = req.body;

      if (!title?.trim()) return res.status(400).json({ error: "title es requerido" });
      if (!areaKey?.trim()) return res.status(400).json({ error: "areaKey es requerido" });

      // ✅ NUEVO: detecta variables del HTML y hace merge
      const html = content.html || "";
      const detected = extractBracketVariables(html);
      const mergedVars = mergeVariables(variables, detected);

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: {
          html,
          json: content.json ?? null
        },
        variables: mergedVars,
        letterheadUrl
      });

      res.status(201).json({ message: "Machote creado", data: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 7) Actualizar machote
  app.put(`${base}/:id`, async (req, res) => {
    try {
      // ✅ NUEVO: Traemos el doc actual para hacer merge seguro
      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

      // ✅ NUEVO: Whitelist para no meter campos raros por error
      const allowed = ["title", "areaKey", "area", "status", "content", "variables", "letterheadUrl"];
      const body = {};
      for (const k of allowed) {
        if (k in req.body) body[k] = req.body[k];
      }

      // Normaliza strings
      if (typeof body.title === "string") body.title = body.title.trim();
      if (typeof body.areaKey === "string") body.areaKey = body.areaKey.trim();

      // Normaliza content si viene
      if (body.content && typeof body.content === "object") {
        body.content = {
          html: body.content.html ?? current.content?.html ?? "",
          json: body.content.json ?? current.content?.json ?? null
        };
      }

      // ✅ NUEVO: merge de variables basado en HTML final
      const finalHtml =
        typeof body.content?.html === "string"
          ? body.content.html
          : (current.content?.html ?? "");

      const detected = extractBracketVariables(finalHtml);

      // Si el front mandó variables, se usan como base; si no, usamos las actuales
      const baseVars = Array.isArray(body.variables) ? body.variables : (current.variables ?? []);
      body.variables = mergeVariables(baseVars, detected);

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        { $set: body },
        { new: true, runValidators: true }
      );

      if (!updated) return res.status(404).json({ error: "Machote no encontrado" });
      res.json({ message: "Machote actualizado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // 8) Borrar machote
  app.delete(`${base}/:id`, async (req, res) => {
    try {
      const deleted = await Machote.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Machote no encontrado" });
      res.json({ message: "Machote eliminado" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });
});

// 9) DB + Start
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