import mongoose from "mongoose";
import jwt from "jsonwebtoken";

/* =========================================================
   Auth middleware
   ========================================================= */

export function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ error: "Falta token Bearer" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      uid: typeof payload?.uid === "string" ? payload.uid.trim() : "",
      rol: typeof payload?.rol === "string" ? payload.rol.trim() : "",
      areas: Array.isArray(payload?.areas)
        ? payload.areas
            .filter((x) => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean)
        : []
    };

    if (!req.user.uid) {
      return res.status(401).json({ error: "Token inválido: uid no disponible" });
    }

    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/* =========================================================
   Schemas compartidos
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

const LetterheadRefSchema = new mongoose.Schema(
  {
    id: { type: String, default: "", index: true },
    areaId: { type: String, default: "" },
    nombre: { type: String, default: "" }
  },
  { _id: false }
);

/* =========================================================
   Modelo: Machote
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
      text: { type: String, default: "" },
      html: { type: String, default: "" },
      json: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    letterheadRef: { type: LetterheadRefSchema, default: () => ({}) },
    letterheadUrl: { type: String, default: "" },
    createdBy: { type: AuditUserSchema, default: () => ({}) },
    updatedBy: { type: AuditUserSchema, default: () => ({}) },
    deactivatedBy: { type: AuditUserSchema, default: () => ({}) },
    reactivatedBy: { type: AuditUserSchema, default: () => ({}) },
    fechaBaja: { type: Date, default: null },
    fechaAlta: { type: Date, default: null }
  },
  { timestamps: true }
);

const DocumentoSchema = new mongoose.Schema(
  {
    machoteId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Machote",
      index: true
    },
    machoteTitle: { type: String, default: "" },

    areaKey: { type: String, required: true, index: true },
    area: { type: String, default: "" },

    folio: { type: String, unique: true, index: true },

    campos: { type: mongoose.Schema.Types.Mixed, default: {} },

    contenidoFinal: { type: String, default: "" },

    letterheadRef: { type: LetterheadRefSchema, default: () => ({}) },
    letterheadUrl: { type: String, default: "" },

    status: {
      type: String,
      enum: ["borrador", "final", "cancelado"],
      default: "borrador",
      index: true
    },

    createdBy: { type: AuditUserSchema, default: () => ({}) },
    updatedBy: { type: AuditUserSchema, default: () => ({}) },
    canceladoPor: { type: AuditUserSchema, default: () => ({}) },
    fechaCancelado: { type: Date, default: null }
  },
  { timestamps: true }
);

export const Machote = mongoose.model("Machote", MachoteSchema, "machotes");
export const Documento = mongoose.model("Documento", DocumentoSchema, "documentos");
export { mongoose, AuditUserSchema, LetterheadRefSchema };