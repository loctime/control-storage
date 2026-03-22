const express = require("express");
const controller = require("./training.controller");

const router = express.Router();

router.get("/catalog", controller.listCatalog);
router.post("/catalog", controller.createCatalog);
router.patch("/catalog/:id", controller.patchCatalog);
router.delete("/catalog/:id", controller.deleteCatalog);

router.get("/plans", controller.listPlans);
router.post("/plans", controller.createPlan);
router.patch("/plans/:id", controller.patchPlan);

router.get("/plans/:id/items", controller.listPlanItems);
router.post("/items", controller.createPlanItem);
router.patch("/items/:id", controller.patchPlanItem);
router.delete("/items/:id", controller.deletePlanItem);

router.get("/sessions", controller.listSessions);
router.post("/sessions", controller.createSession);
router.patch("/sessions/:id", controller.patchSession);

router.post("/sessions/:id/attendance", controller.registerAttendance);
router.get("/dashboard", controller.getDashboard);
router.get("/employees/:employeeId/status", controller.getEmployeeTrainingStatus);

module.exports = router;
