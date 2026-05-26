import { adminDb } from "../../lib/firebase/admin.ts";

export { adminDb };

export const imessageUsersCol = () => adminDb.collection("imessageUsers");
