import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import { resolve, join } from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, settingsTable } from "@workspace/db";

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const sessionSecret = process.env["SESSION_SECRET"] ?? "balance-alert-secret-change-me";

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
  // Always allow: health check, auth routes
  if (req.path === "/healthz" || req.path.startsWith("/auth/")) {
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
  app.get("*", (_req, res) => {
    res.sendFile(join(frontendDist, "index.html"));
  });
} else {
  logger.warn({ frontendDist }, "Frontend dist not found — build the frontend first");
}

export default app;
