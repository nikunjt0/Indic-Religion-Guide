import { adminDb } from "@/lib/firebase/admin";
import { verifyStripeSignature } from "@/lib/billing/webhook";
import { syncSubscriptionToUser } from "@/lib/billing/sync";

// Stripe webhook: keeps imessageUsers/{handleId}.billing mirroring the live
// subscription. checkout.session.completed carries client_reference_id (the
// handleId baked into the payment link the bridge texted out), which is the
// one moment we can tie a Stripe customer to a texting user; every later
// subscription event is matched by stored subscription id.

interface StripeEvent {
  type?: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      subscription?: string | null;
    };
  };
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("webhook not configured", { status: 500 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!verifyStripeSignature(payload, signature, secret)) {
    return new Response("invalid signature", { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const object = event.data?.object ?? {};

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const subscriptionId = object.subscription;
        const handleId = object.client_reference_id;
        if (subscriptionId && handleId) {
          await syncSubscriptionToUser(adminDb, { subscriptionId, handleId });
        } else {
          console.warn("checkout.session.completed without subscription/client_reference_id", {
            session: object.id,
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        if (object.id) {
          const result = await syncSubscriptionToUser(adminDb, { subscriptionId: object.id });
          if (!result.synced) {
            // Expected for subscription.created racing checkout completion.
            console.warn(`no user linked to subscription ${object.id} yet (${event.type})`);
          }
        }
        break;
      }
      default:
        break; // Not subscribed to anything else; acknowledge and move on.
    }
  } catch (err) {
    // Non-2xx makes Stripe retry with backoff — right for transient
    // Firestore/Stripe hiccups.
    console.error(`stripe webhook ${event.type} failed`, err);
    return new Response("handler error", { status: 500 });
  }

  return Response.json({ received: true });
}
