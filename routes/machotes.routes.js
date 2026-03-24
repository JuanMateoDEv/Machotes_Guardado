import { Router } from "express";
import { Machote, mongoose, authMiddleware } from "../core/models.js";
import {
  normalizeActor,
  resolveLetterheadRef,
  resolveFinalText
} from "../core/helpers.js";

const router = Router();
const baseRoutes = ["/machotes", "/templates"];

baseRoutes.forEach((base) => {
  // Listar
  router.get(base, authMiddleware, async (req, res) => {
    try {
      const { term = "", includeInactive = "false" } = req.query;
      const allowedAreas = Array.isArray(req.user?.areas) ? req.user.areas : [];

      const isSuperAdmin =
        String(req.user?.rol || "").trim().toLowerCase() === "administrador" ||
        String(req.user?.rol || "").trim().toUpperCase() === "ADMIN";

      const filter = {};

      if (!isSuperAdmin) {
        if (!allowedAreas.length) {
          return res.status(403).json({ error: "El usuario no tiene áreas permitidas" });
        }

        filter.area = { $in: allowedAreas };
      }

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

  // Mis machotes
  router.get(`${base}/mis-machotes`, authMiddleware, async (req, res) => {
    try {
      const { term = "", includeInactive = "false" } = req.query;
      const allowedAreas = Array.isArray(req.user?.areas) ? req.user.areas : [];

      const isSuperAdmin =
        String(req.user?.rol || "").trim().toLowerCase() === "administrador" ||
        String(req.user?.rol || "").trim().toUpperCase() === "ADMIN";

      if (!req.user?.uid) {
        return res.status(403).json({ error: "El usuario autenticado no es válido" });
      }

      const filter = {};

      if (!isSuperAdmin) {
        if (!allowedAreas.length) {
          return res.status(403).json({ error: "El usuario no tiene áreas permitidas" });
        }

        filter.area = { $in: allowedAreas };
        filter["createdBy.userId"] = req.user.uid;
      }

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

  // Obtener 1 por ID
  router.get(`${base}/:id`, authMiddleware, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const allowedAreas = Array.isArray(req.user?.areas) ? req.user.areas : [];

      const isSuperAdmin =
        String(req.user?.rol || "").trim().toLowerCase() === "administrador" ||
        String(req.user?.rol || "").trim().toUpperCase() === "ADMIN";

      let doc;

      if (isSuperAdmin) {
        doc = await Machote.findById(req.params.id).lean();
      } else {
        if (!allowedAreas.length) {
          return res.status(403).json({ error: "El usuario no tiene áreas permitidas" });
        }

        doc = await Machote.findOne({
          _id: req.params.id,
          area: { $in: allowedAreas }
        }).lean();
      }

      if (!doc) return res.status(404).json({ error: "Machote no encontrado" });

      res.json({ data: doc });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Crear
  router.post(base, async (req, res) => {
    try {
      const {
        title,
        areaKey,
        area = "",
        status = "active",
        content = {},
        actor = {}
      } = req.body;

      if (!title?.trim()) return res.status(400).json({ error: "title es requerido" });
      if (!areaKey?.trim()) return res.status(400).json({ error: "areaKey es requerido" });

      const finalText = resolveFinalText(content, {});
      const auditActor = normalizeActor(actor);
      const letterheadData = resolveLetterheadRef(req.body, {});
      const now = new Date();

      const created = await Machote.create({
        title: title.trim(),
        areaKey: areaKey.trim(),
        area,
        status,
        content: { text: finalText, html: "", json: null },
        ...letterheadData,
        createdBy: auditActor,
        updatedBy: auditActor,
        deactivatedBy: status === "inactive" ? auditActor : {},
        reactivatedBy: {},
        fechaBaja: status === "inactive" ? now : null,
        fechaAlta: null
      });

      res.status(201).json({ message: "Machote creado", data: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Actualizar
  router.put(`${base}/:id`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const current = await Machote.findById(req.params.id).lean();
      if (!current) return res.status(404).json({ error: "Machote no encontrado" });

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
      const nextStatus = typeof body.status === "string" ? body.status : current.status;

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
            content: { text: finalText, html: "", json: null },
            ...letterheadData,
            updatedBy: auditActor,
            ...statusPatch
          }
        },
        { returnDocument: "after", runValidators: true }
      );

      res.json({ message: "Machote actualizado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Desactivar
  router.post(`${base}/:id/deactivate`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const auditActor = normalizeActor(req.body.actor || {});
      const current = await Machote.findById(req.params.id).lean();

      if (!current) return res.status(404).json({ error: "Machote no encontrado" });
      if (current.status === "inactive") {
        return res.json({ message: "Machote ya estaba inactivo", data: current });
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "inactive",
            fechaBaja: new Date(),
            deactivatedBy: auditActor,
            updatedBy: auditActor
          }
        },
        { returnDocument: "after", runValidators: true }
      );

      res.json({ message: "Machote dado de baja", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });

  // Reactivar
  router.post(`${base}/:id/reactivate`, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "ID inválido" });
      }

      const auditActor = normalizeActor(req.body.actor || {});
      const current = await Machote.findById(req.params.id).lean();

      if (!current) return res.status(404).json({ error: "Machote no encontrado" });
      if (current.status !== "inactive") {
        return res.status(400).json({ error: "Solo se pueden reactivar machotes inactivos" });
      }

      const updated = await Machote.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "active",
            fechaAlta: new Date(),
            reactivatedBy: auditActor,
            updatedBy: auditActor
          }
        },
        { returnDocument: "after", runValidators: true }
      );

      res.json({ message: "Machote reactivado", data: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno", details: err.message });
    }
  });
});

export default router;