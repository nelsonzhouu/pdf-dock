/**
 * app/api/create-checkout-session/route.ts
 *
 * POST /api/create-checkout-session
 *
 * Creates a Stripe Checkout session for the donation flow.
 * Returns { sessionId } which the client uses with Stripe.js to redirect.
 *
 * Security notes:
 * - STRIPE_SECRET_KEY is only accessed server-side in this route.
 *   It is never included in the client bundle.
 * - Input is validated: amount must be a positive integer >= 100 (cents).
 * - In production, add rate limiting via Vercel middleware.
 */

import { NextResponse } from "next/server";

// Stripe is imported dynamically to avoid bundling the secret key in any
// client-side chunk. This module only runs in the Node.js (server) runtime.
import Stripe from "stripe";

/** Minimum donation: $1.00 expressed in cents. */
const MIN_AMOUNT_CENTS = 100;

export async function POST(request: Request) {
  // Validate Content-Type.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }

  // Parse and validate request body.
  let amountCents: number;
  try {
    const body = await request.json() as { amount?: unknown };
    const raw = body.amount;

    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < MIN_AMOUNT_CENTS) {
      return NextResponse.json(
        { error: `amount must be an integer >= ${MIN_AMOUNT_CENTS} (cents)` },
        { status: 400 }
      );
    }

    amountCents = raw;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate Stripe secret key is configured.
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("[create-checkout-session] STRIPE_SECRET_KEY is not set");
    return NextResponse.json(
      { error: "Payment processing is not configured" },
      { status: 503 }
    );
  }

  const stripe = new Stripe(stripeSecretKey);

  // Derive the base URL for success/cancel redirects.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "PDFDock Donation",
              description: "Support free, private PDF tools for everyone.",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/donate/success`,
      cancel_url: `${baseUrl}/donate`,
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (err) {
    console.error("[create-checkout-session] Stripe error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
