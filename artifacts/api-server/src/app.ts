import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import { resolve, join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, settingsTable } from "@workspace/db";

const FileStore = FileStoreFactory(session);

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const sessionSecret = process.env["SESSION_SECRET"] ?? "balance-alert-secret-change-me";

// Persist sessions to disk so restarts don't invalidate logged-in users and
// to avoid the MemoryStore production warning.
const __filename = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename);
// Place sessions folder next to the built bundle, or use SESSIONS_PATH override.
const sessionsPath = process.env["SESSIONS_PATH"] ?? resolve(__dirname_esm, "../sessions");
if (!existsSync(sessionsPath)) {
  mkdirSync(sessionsPath, { recursive: true });
}
logger.info({ sessionsPath }, "Session file store initialized");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
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
      ttl: 8 * 60 * 60, // 8 hours in seconds
      reapInterval: 60 * 60, // clean up expired sessions every hour
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// Auth guard middleware: enforce TOTP login when it's enabled
app.use("/api", async (req, res, next) => {
  // Always allow: health check, monitoring probes, auth routes
  if (req.path === "/healthz" || req.path.startsWith("/health/") || req.path.startsWith("/auth/")) {
    return next();
  }

  // If already authenticated via session, allow through
  if (req.session.authenticated) {
    return next();
  }

  // Check if auth is required
  try {
    const rows = await db.select({ totpEnabled: settingsTable.totpEnabled }).from(settingsTable).limit(1);
    const totpEnabled = rows[0]?.totpEnabled ?? false;
    if (!totpEnabled) {
      return next();
    }
  } catch {
    // If DB check fails, allow through (don't block on DB error)
    return next();
  }

  res.status(401).json({ error: "Authentication required" });
});

app.use("/api", router);

// Serve the React SPA from the same Express process when the frontend dist is present.
// This eliminates the need for nginx when running on a single port.
const frontendDist =
  process.env.FRONTEND_DIST ??
  resolve(__dirname, "../../../artifacts/balance-alerts/dist/public");

if (existsSync(frontendDist)) {
  logger.info({ frontendDist }, "Serving React frontend static files");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(join(frontendDist, "index.html"));
  });
} else {
  logger.warn({ frontendDist }, "Frontend dist not found — build the frontend first");
}

export default app;
