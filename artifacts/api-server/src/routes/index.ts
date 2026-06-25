import { Router, type IRouter } from "express";
import { requireRole } from "../app.js";
import healthRouter from "./health.js";
import contactsRouter from "./contacts.js";
import settingsRouter from "./settings.js";
import grafanaRouter from "./grafana.js";
import alertHistoryRouter from "./alertHistory.js";
import authRouter from "./auth.js";
import telegramRouter from "./telegram.js";
import usersRouter from "./users.js";
import auditLoginRouter from "./auditLogin.js";

const router: IRouter = Router();

// Public-ish (auth guard already on /api globally in app.ts)
router.use(authRouter);
router.use(healthRouter);

// Viewer + admin routes
router.use(contactsRouter);
router.use(grafanaRouter);
router.use(alertHistoryRouter);

// Admin-only routes
router.use(requireRole("admin"), settingsRouter);
router.use(requireRole("admin"), telegramRouter);
router.use(requireRole("admin"), usersRouter);
router.use(requireRole("admin"), auditLoginRouter);

export default router;
