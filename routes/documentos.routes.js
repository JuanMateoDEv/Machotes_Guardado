import { Router } from "express";
import { Documento, Machote, mongoose } from "../core/models.js";
import {
  normalizeActor,
  interpolateText,
  generateFolio
} from "../core/helpers.js";

const router = Router();

router.get("/documentos", async (req, res) => {
  try {
    const {
      machoteId = "",
      areaKey = "",
      status = "",
      term = "",
      page = "1",
      limit = "20"
    } = req.query;

    const filter = {};

    if (machoteId && mongoose.isValidObjectId(machoteId)) {
      filter.machoteId = machoteId;
    }
    if (areaKey) filter.areaKey = areaKey;
    if (status) filter.status = status;
    else filter.status = { $ne: "cancelado" };

    if (typeof term === "string" && term.trim()) {
      filter.folio = { $regex: term.trim(), $options: "i" };
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Documento.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Documento.countDocuments(filter)
    ]);

    res.json({
      items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

router.get("/documentos/:id", async (req, res) => {
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

router.post("/documentos", async (req, res) => {
  try {
    const { machoteId, campos = {}, status = "borrador", actor = {} } = req.body;

    if (!machoteId) {
      return res.status(400).json({ error: "machoteId es requerido" });
    }
    if (!mongoose.isValidObjectId(machoteId)) {
      return res.status(400).json({ error: "machoteId inválido" });
    }
    if (!["borrador", "final"].includes(status)) {
      return res.status(400).json({ error: "status debe ser borrador o final" });
    }

    const machote = await Machote.findById(machoteId).lean();
    if (!machote) {
      return res.status(404).json({ error: "Machote no encontrado" });
    }
    if (machote.status === "inactive") {
      return res.status(400).json({
        error: "No se puede crear un documento de un machote inactivo"
      });
    }

    const folio = await generateFolio(machote.areaKey);
    const contenidoFinal = interpolateText(machote.content?.text || "", campos);
    const auditActor = normalizeActor(actor);

    const created = await Documento.create({
      machoteId,
      machoteTitle: machote.title,
      areaKey: machote.areaKey,
      area: machote.area,
      folio,
      campos,
      contenidoFinal,
      letterheadRef: machote.letterheadRef || {},
      letterheadUrl: machote.letterheadUrl || "",
      status,
      createdBy: auditActor,
      updatedBy: auditActor,
      canceladoPor: {},
      fechaCancelado: null
    });

    res.status(201).json({ message: "Documento creado", data: created });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Folio duplicado, intenta de nuevo" });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno", details: err.message });
  }
});

router.put("/documentos/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const current = await Documento.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ error: "Documento no encontrado" });

    if (current.status !== "borrador") {
      return res.status(400).json({
        error: `El documento no se puede editar porque su status es "${current.status}"`
      });
    }

    const { campos, status, actor = {} } = req.body;
    const auditActor = normalizeActor(actor);

    if (status && !["borrador", "final"].includes(status)) {
      return res.status(400).json({ error: "status debe ser borrador o final" });
    }

    const nextCampos =
      campos && typeof campos === "object"
        ? { ...current.campos, ...campos }
        : current.campos;

    const machote = await Machote.findById(current.machoteId).lean();
    const contenidoFinal = machote
      ? interpolateText(machote.content?.text || "", nextCampos)
      : current.contenidoFinal;

    const updated = await Documento.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          campos: nextCampos,
          contenidoFinal,
          status: status || current.status,
          updatedBy: auditActor
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

router.delete("/documentos/:id", async (req, res) => {
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
          status: "cancelado",
          fechaCancelado: new Date(),
          updatedBy: auditActor,
          canceladoPor: auditActor
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

export default router;