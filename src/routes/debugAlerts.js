const express = require("express");
const router = express.Router();
const { simulateAlertFromEmail } = require("../services/alertSimulationService");

router.post("/debug/simulate-alert", async (req, res) => {
  try {
    const body = req.body || {};
    const subject = typeof body.subject === "string" ? body.subject : "";
    const emailBody = typeof body.body === "string" ? body.body : "";
    const receivedAt = body.received_at == null ? null : String(body.received_at);

    if (!subject.trim() && !emailBody.trim()) {
      return res.status(400).json({
        error: "subject or body is required",
      });
    }

    const result = simulateAlertFromEmail({
      subject,
      body: emailBody,
      receivedAt,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[debug/simulate-alert] Error simulando alerta RSV", {
      errorMessage: error?.message,
      errorStack: error?.stack,
      subject: req?.body?.subject,
      hasBody: typeof req?.body?.body === "string",
      received_at: req?.body?.received_at,
    });

    return res.status(500).json({
      error: "error interno",
      // Esta ruta es solo de debug, devolvemos el mensaje SIEMPRE
      message: error?.message || "Error desconocido en simulateAlertFromEmail",
    });
  }
});

module.exports = router;
