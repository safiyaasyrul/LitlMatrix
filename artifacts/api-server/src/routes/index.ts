import { Router, type IRouter } from "express";
import healthRouter from "./health";
import prismaRouter from "./prisma";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/prisma", prismaRouter);

export default router;
