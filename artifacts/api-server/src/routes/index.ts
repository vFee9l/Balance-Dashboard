import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contactsRouter from "./contacts";
import settingsRouter from "./settings";
import grafanaRouter from "./grafana";
import alertHistoryRouter from "./alertHistory";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(contactsRouter);
router.use(settingsRouter);
router.use(grafanaRouter);
router.use(alertHistoryRouter);

export default router;
