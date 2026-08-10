import type { Firestore } from "firebase-admin/firestore";
import { getSubscription, billingStateFrom } from "./stripe";
import { hasMessagingAccess } from "./membership";

// Sync one Stripe subscription's current state onto the owning imessageUsers
// doc. Always re-fetches the subscription from Stripe (pinned API version)
// instead of trusting webhook payload shapes, so duplicate and out-of-order
// events converge on the same truth.

const USERS = "imessageUsers";

export interface SyncResult {
  synced: boolean;
  reason?: "user-not-found";
  handleId?: string;
}

export async function syncSubscriptionToUser(
  db: Firestore,
  opts: {
    subscriptionId: string;
    /** Known for checkout.session.completed (client_reference_id). */
    handleId?: string;
  }
): Promise<SyncResult> {
  let handleId = opts.handleId;
  if (!handleId) {
    const snap = await db
      .collection(USERS)
      .where("billing.stripeSubscriptionId", "==", opts.subscriptionId)
      .limit(1)
      .get();
    // subscription.created usually races checkout.session.completed; before
    // the checkout event links the ids there is no doc to update yet.
    if (snap.empty) return { synced: false, reason: "user-not-found" };
    handleId = snap.docs[0].id;
  }

  const now = Date.now();
  const billing = billingStateFrom(await getSubscription(opts.subscriptionId), now);
  const paying = hasMessagingAccess(billing, now);
  await db
    .collection(USERS)
    .doc(handleId)
    .set(
      {
        billing,
        // Kept in sync for the entitlements service (lib/entitlements.ts).
        subscriptionTier: paying ? "individual" : "free",
        subscriptionStatus: billing.status === "none" ? "canceled" : billing.status,
        // A fresh trial/renewal re-arms the one-time "membership ended" text.
        ...(billing.status === "trialing" || billing.status === "active"
          ? { membershipEndNoticeSent: false }
          : {}),
        updatedAt: now,
      },
      { merge: true }
    );
  return { synced: true, handleId };
}
