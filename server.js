import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";

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