import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import { resolve, join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const FileStore = FileStoreFactory(session);

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
    userId: number;
    role: string;
    username: string;
    pendingUserId: number;
    pendingNeedsSetup: boolean;
    pendingTotpEnc: string;
  }
}

const sessionSecret = process.env["SESSION_SECRET"] ?? "balance-alert-secret-change-me";

const __filename = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename);
const sessionsPath = process.env["SESSIONS_PATH"] ?? resolve(__dirname_esm, "../sessions");
if (!existsSync(sessionsPath)) mkdirSync(sessionsPath, { recursive: true });
logger.info({ sessionsPath }, "Session file store initialized");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new FileStore({
      path: sessionsPath,
      retries: 1,
      ttl: 8 * 60 * 60,
      reapInterval: 60 * 60,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

// ─── Auth guard ───────────────────────────────────────────────────────────────
app.use("/api", (req, res, next): void => {
  if (
    req.path === "/healthz" ||
    req.path.startsWith("/health/") ||
    req.path.startsWith("/auth/")
  ) {
    next(); return;
  }
  if (req.session.userId) { next(); return; }
  res.status(401).json({ error: "Authentication required" });
});

// ─── Role guard factory ───────────────────────────────────────────────────────
export function requireRole(role: "admin" | "viewer") {
  return (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ): void => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Authentication required" }); return;
    }
    if (role === "admin" && req.session.role !== "admin") {
      res.status(403).json({ error: "Insufficient permissions" }); return;
    }
    next();
  };
}

app.use("/api", router);

// Serve React SPA
const frontendDist =
  process.env.FRONTEND_DIST ??
  resolve(__dirname_esm, "../../../artifacts/balance-alerts/dist/public");

if (existsSync(frontendDist)) {
  logger.info({ frontendDist }, "Serving React frontend static files");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => { res.sendFile(join(frontendDist, "index.html")); });
} else {
  logger.warn({ frontendDist }, "Frontend dist not found — build the frontend first");
}

export default app;
