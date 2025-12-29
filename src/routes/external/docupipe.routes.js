import express from "express";

const router = express.Router();

/**
 * DocuPipe webhook -> forward to NiFi
 * URL example: /api/v1/webhooks/docupipe
 */
router.post("/webhooks/docupipe", async (req, res) => {
  try {
    // Optional: shared-secret header from DocuPipe -> you set it in DocuPipe UI
    const expected = process.env.DOCUPIPE_WEBHOOK_SECRET;
    if (expected) {
      const incoming = req.get("x-webhook-secret"); // or whatever header name you choose
      if (!incoming || incoming !== expected) return res.status(401).send("unauthorized");
    }

    // Build event for NiFi
    const event = {
      source: "docupipe",
      received_at: new Date().toISOString(),
      headers: req.headers,
      body: req.body,
    };

    // Forward to NiFi (fire-and-forget so DocuPipe gets a fast 200)
    const nifiUrl = process.env.NIFI_WEBHOOK_URL; // e.g. http://10.0.0.x:8080/ingest/docupipe
    const nifiSecret = process.env.NIFI_SHARED_SECRET;

    if (!nifiUrl) {
      console.error("NIFI_WEBHOOK_URL not set");
      return res.status(200).send("ok");
    }

    fetch(nifiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nifi-shared-secret": nifiSecret || "",
      },
      body: JSON.stringify(event),
    }).catch((err) => console.error("Forward to NiFi failed:", err));

    return res.status(200).send("ok");
  } catch (e) {
    console.error("DocuPipe webhook error:", e);
    // still 200 to prevent retries storms
    return res.status(200).send("ok");
  }
});

export default router;
