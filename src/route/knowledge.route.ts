import { Router } from "express";

import { KnowledgeController } from "@app/controller";

const router = Router();
const controller = new KnowledgeController();

router.post("/reindex", controller.reindex);

export default router;
