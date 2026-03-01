"use strict";

const express = require("express");
const router = express.Router();
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Map your Stripe Price IDs here (from Dashboard)
const PRICE_BY_PLAN = {
  core: process.env.STRIPE_PRICE_CORE,
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENT,
};

// Helpers
function requireSession(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

async function getOrCreateStripeCustomer(req) {
  const userId = req.session.userId;

  const { rows } = await req.db.query(
    `SELECT id, email, stripe_customer_id FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) throw new Error("User not found");

  const user = rows[0];

  if (user.stripe_customer_id) {
    return { customerId: user.stripe_customer_id, email: user.email };
  }

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId: String(userId) },
  });

  await req.db.query(
    `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
    [customer.id, userId]
  );

  return { customerId: customer.id, email: user.email };
}

/**
 * POST /billing/checkout
 * Body: { plan: "core" | "pro" | "enterprise" }
 * Returns: { url }
 */
router.post("/billing/checkout", async (req, res) => {
  if (!requireSession(req, res)) return;

  try {
    const plan = String(req.body?.plan || "core").toLowerCase().trim();
    const priceId = PRICE_BY_PLAN[plan];

    if (!priceId) {
      return res.status(400).json({ error: "Invalid plan." });
    }

    const { customerId } = await getOrCreateStripeCustomer(req);

    const baseUrl =
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/billing-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing-canceled`,
      allow_promotion_codes: true,
      metadata: {
        userId: String(req.session.userId),
        plan,
      },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error("POST /billing/checkout error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

//Billing Portal
router.post("/billing/portal", async (req, res) => {
  if (!requireSession(req, res)) return;

  try {
    const { customerId } = await getOrCreateStripeCustomer(req);

    const baseUrl =
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    // allow only internal return paths
    const returnPath = String(req.body?.returnPath || "/account?tab=billing");
    const safeReturnPath =
      returnPath.startsWith("/") ? returnPath : "/account?tab=billing";

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}${safeReturnPath}`,
    });

    return res.json({ url: portal.url });
  } catch (e) {
    console.error("POST /billing/portal error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /billing/session?session_id=cs_...
 * Returns: { ok, plan, price, email, subscriptionId, subscriptionStatus }
 */
router.get("/billing/session", async (req, res) => {
  if (!requireSession(req, res)) return;

  try {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Invalid session_id" });
    }

    // 1) Session (metadata + customer_details + subscription)
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    // 2) Line items (reliable way to get the price)
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 1,
      expand: ["data.price"],
    });

    const plan = session?.metadata?.plan || null;

    const sub = session.subscription;
    const subscriptionId = typeof sub === "string" ? sub : sub?.id || null;
    const subscriptionStatus =
      typeof sub === "object" ? sub?.status : null;

    const email =
      session.customer_details?.email ||
      session.customer_email ||
      null;

    const line = lineItems.data?.[0];
    const price = line?.price;

    let priceText = null;
    if (price?.unit_amount != null) {
      const amount = (price.unit_amount / 100).toFixed(0);
      const interval = price.recurring?.interval || "mo";
      priceText = `$${amount}/${interval}`;
    }

    return res.json({
      ok: true,
      plan,
      price: priceText,
      email,
      subscriptionId,
      subscriptionStatus,
    });
  } catch (e) {
    console.error("GET /billing/session error:", e);
    return res.status(500).json({ error: "Failed to retrieve session" });
  }
});

module.exports = router;
