import express from "express";
import cors from "cors";
import machotesRoutes from "./routes/machotes.routes.js";
import documentosRoutes from "./routes/documentos.routes.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(machotesRoutes);
app.use(documentosRoutes);

export default app;