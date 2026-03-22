const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

/**
 * Helper: Sleep para retry con backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper: Obtener email recibido desde Resend API con retry
 */
async function fetchReceivedEmail(emailId, apiKey, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(
        `https://api.resend.com/emails/receiving/${emailId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        }
      );

      const data = response.data?.data;

      if (data) {
        return data;
      }

      console.log(
        `⏳ [EMAIL-INBOUND] Intento ${attempt}/${maxRetries} sin data, reintentando...`
      );

    } catch (err) {
      console.error(
        `❌ [EMAIL-INBOUND] Error en intento ${attempt}:`,
        err.response?.data || err.message
      );
    }

    // Backoff progresivo
    await sleep(attempt * 700);
  }

  return null;
}

/**
 * POST /email-inbound
 *
 * Flujo correcto para Resend Inbound:
 * 1. Resend envía webhook con metadata + email_id
 * 2. El webhook NO trae html/text
 * 3. Se consulta la Receiving API con email_id
 * 4. Se obtiene el contenido real del email
 * 5. Se procesa y queda listo para persistir
 */
router.post("/email-inbound", async (req, res) => {
  console.log("RAW BODY:", JSON.stringify(req.body, null, 2));
  // ⚠️ SIEMPRE responder 200 para no romper el webhook
  try {
    console.log("📩 [EMAIL-INBOUND] Webhook recibido");

    // --- Verificación básica ---
    const eventType = req.body?.type;
    const webhookData = req.body?.data;

    if (!eventType || !webhookData) {
      console.log("⚠️ [EMAIL-INBOUND] Payload inválido");
      return res.status(200).send("OK");
    }

    if (eventType !== "email.received") {
      console.log("ℹ️ [EMAIL-INBOUND] Evento ignorado:", eventType);
      return res.status(200).send("OK");
    }

    // --- Metadata del webhook ---
    const emailId = webhookData.email_id;
    if (!emailId) {
      console.log("⚠️ [EMAIL-INBOUND] email_id ausente");
      return res.status(200).send("OK");
    }

    console.log("📧 [EMAIL-INBOUND] email_id:", emailId);
    console.log("   From:", webhookData.from || "N/A");
    console.log("   To:", webhookData.to || "N/A");
    console.log("   Subject:", webhookData.subject || "N/A");

    // --- API KEY ---
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("❌ [EMAIL-INBOUND] RESEND_API_KEY no configurada");
      return res.status(200).send("OK");
    }

    // --- Obtener contenido real desde Resend con retry ---
    const email = await fetchReceivedEmail(emailId, apiKey);

    if (!email) {
      console.log("⚠️ [EMAIL-INBOUND] Email no disponible tras reintentos");
      return res.status(200).send("OK");
    }

    console.log("✅ [EMAIL-INBOUND] Email completo obtenido");

    // --- Campos reales del email ---
    const emailData = {
      email_id: emailId,
      message_id: email.message_id || null,
      from: email.from || webhookData.from || null,
      to: Array.isArray(email.to) ? email.to : [],
      cc: Array.isArray(email.cc) ? email.cc : [],
      bcc: Array.isArray(email.bcc) ? email.bcc : [],
      subject: email.subject || webhookData.subject || "(sin asunto)",
      html: email.html || null,
      text: email.text || null,
      headers: email.headers || {},
      attachments: Array.isArray(email.attachments) ? email.attachments : [],
      created_at: email.created_at || webhookData.created_at || null,
      receivedAt: new Date().toISOString()
    };

    console.log("📄 [EMAIL-INBOUND] Contenido:");
    console.log("   HTML:", emailData.html ? "sí" : "no");
    console.log("   TEXT:", emailData.text ? "sí" : "no");
    console.log("   Attachments:", emailData.attachments.length);

    // --- Parseo HTML (si existe) ---
    if (emailData.html) {
      try {
        const $ = cheerio.load(emailData.html);
        const plainTextFromHtml = $.text().trim();

        emailData.plainTextFromHtml = plainTextFromHtml;

        console.log(
          "🔍 [EMAIL-INBOUND] Texto extraído del HTML:",
          plainTextFromHtml.length,
          "caracteres"
        );
      } catch (err) {
        console.error("❌ [EMAIL-INBOUND] Error parseando HTML:", err.message);
      }
    }

    // --- Listo para persistir ---
    console.log("💾 [EMAIL-INBOUND] Email listo para persistir");
    console.log({
      email_id: emailData.email_id,
      subject: emailData.subject,
      from: emailData.from,
      to: emailData.to,
      has_html: !!emailData.html,
      has_text: !!emailData.text,
      attachments: emailData.attachments.length
    });

    // TODO:
    // await firestore
    //   .collection("apps")
    //   .doc("emails")
    //   .collection(ownerId)
    //   .add(emailData);

  } catch (err) {
    console.error("❌ [EMAIL-INBOUND] Error inesperado:", err.message);
  }

  return res.status(200).send("OK");
});

module.exports = router;
