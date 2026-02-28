"use strict";

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});

module.exports = async function stripeWebhookHandler(req, res) {
  let event;

  try {
    const sig = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      req.rawBody, // MUST be raw body
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const { pool } = require("../../db/pool");

    // ===== CHECKOUT COMPLETED =====
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;

      if (!userId) {
        console.error("Missing userId in metadata");
        return res.json({ received: true });
      }

      const stripeCustomerId = session.customer;
      const stripeSubscriptionId = session.subscription;

      // Fetch subscription to get real status + period end
      const subscription = await stripe.subscriptions.retrieve(
        stripeSubscriptionId
      );

      const status = subscription.status;
      const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      const cancelAtPeriodEnd = subscription.cancel_at_period_end;

      await pool.query(
        `
        UPDATE users
        SET
          plan = $1,
          subscription_status = $2,
          stripe_customer_id = $3,
          stripe_subscription_id = $4,
          current_period_end = $5,
          cancel_at_period_end = $6
        WHERE id = $7
        `,
        [
          plan,
          status,
          stripeCustomerId,
          stripeSubscriptionId,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          userId
        ]
      );

      console.log("User upgraded:", userId, plan);
    }

    // ===== SUBSCRIPTION UPDATED =====
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;

      const stripeCustomerId = subscription.customer;
      const status = subscription.status;
      const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      const cancelAtPeriodEnd = subscription.cancel_at_period_end;

      await pool.query(
        `
        UPDATE users
        SET
          subscription_status = $1,
          current_period_end = $2,
          cancel_at_period_end = $3
        WHERE stripe_customer_id = $4
        `,
        [status, currentPeriodEnd, cancelAtPeriodEnd, stripeCustomerId]
      );

      console.log("Subscription updated:", stripeCustomerId, status);
    }

    // ===== SUBSCRIPTION CANCELED =====
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;

      await pool.query(
        `
        UPDATE users
        SET subscription_status = 'canceled'
        WHERE stripe_customer_id = $1
        `,
        [stripeCustomerId]
      );

      console.log("Subscription canceled:", stripeCustomerId);
    }

    // ===== PAYMENT FAILED =====
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

      console.log("Payment failed:", stripeCustomerId);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    res.status(500).send("Webhook handler failed");
  }
};
