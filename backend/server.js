import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";

import { judgeHandler } from "./src/routes/judge.js";

dotenv.config();

const app = express();
const logger = pino({
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Minimal auth: supports debug_user_id for local testing.
// In production, replace with real auth middleware.
app.use((req, _res, next) => {
  const debug = req.query.debug_user_id;
  req.userId = typeof debug === "string" && debug.length > 0 ? debug : null;
  req.requestId = uuidv4();
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/judge", (req, res) => judgeHandler(req, res, logger));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  logger.info({ port }, "Vercrax backend listening");
});
