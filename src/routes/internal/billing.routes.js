"use strict";

const express = require("express");
const router = express.Router();
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Map your Stripe Price IDs here (from Dashboard)
const PRICE_BY_PLAN = {
  core: process.env.STRIPE_PRICE_CORE,         // e.g. price_123
  pro: process.env.STRIPE_PRICE_PRO,           // e.g. price_456
  enterprise: process.env.STRIPE_PRICE_ENT,    // optional (could be null if “Contact sales”)
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
  // You can store stripe_customer_id on your users table.
  // Adjust column/table names to match your schema.
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

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

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
  console.error("POST /api/billing/checkout error:", e);
  return res.status(500).json({ error: e.message || "Server error" });
}
});

/**
 * POST /billing/portal
 * Returns: { url } to Stripe Billing Portal
 */
router.post("/billing/portal", async (req, res) => {
  if (!requireSession(req, res)) return;

  try {
    const { customerId } = await getOrCreateStripeCustomer(req);

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/billing`,
    });

    return res.json({ url: portal.url });
  } catch (e) {
    console.error("POST /billing/portal error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// billing.routes.js
router.get("/billing/session", async (req, res) => {
  if (!requireSession(req, res)) return;

module.exports = router;
