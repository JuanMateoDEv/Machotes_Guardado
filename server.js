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
    area: { type: String, default: "" },                    // "Recursos Humanos"
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

      const items = await Machote.find(filter)
        .sort({ updatedAt: -1 })
        .lean();

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

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: {
          html: content.html || "",
          json: content.json ?? null
        },
        variables,
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
      const updated = await Machote.findByIdAndUpdate(req.params.id, req.body, { new: true });
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