"use strict";

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

module.exports = async function stripeWebhookHandler(req, res) {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // You have req.db normally via middleware, but this route is mounted before that.
    // So we must import pool directly.
    const { pool } = require("../../db/pool");

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;

      const stripeCustomerId = session.customer;
      const stripeSubscriptionId = session.subscription;

      if (userId && plan) {
        await pool.query(
          `
          UPDATE users
          SET
            plan = $1,
            subscription_status = 'active',
            stripe_customer_id = $2,
            stripe_subscription_id = $3
          WHERE id = $4
          `,
          [plan, stripeCustomerId, stripeSubscriptionId, userId]
        );
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const stripeCustomerId = sub.customer;

      await pool.query(
        `
        UPDATE users
        SET subscription_status = 'canceled'
        WHERE stripe_customer_id = $1
        `,
        [stripeCustomerId]
      );
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;

      await pool.query(
        `
        UPDATE users
        SET subscription_status = 'past_due'
        WHERE stripe_customer_id = $1
        `,
        [stripeCustomerId]
      );
    }

    // Always 200 so Stripe stops retrying
    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    res.status(500).send("Webhook handler failed");
  }
};
