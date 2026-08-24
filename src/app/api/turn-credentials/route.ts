import { NextResponse } from "next/server";
import crypto from "crypto";

// Mints short-lived TURN credentials using coturn's standard REST-API
// credential scheme (use-auth-secret + static-auth-secret in
// turnserver.conf) — the same pattern coturn's own docs and every major
// TURN provider (Twilio, Xirsys) use, not a static username/password baked
// into the client bundle. TURN_STATIC_AUTH_SECRET stays server-side only;
// this route hands out a username:expiry pair and an HMAC-SHA1 credential
// derived from it, valid for one hour.
//
// Advisory-adjacent note for consistency with the rest of this app: unlike
// every other "advisory" endpoint here, there's nothing to be advisory
// about — this just lets a legitimate call participant's browser complete
// NAT traversal. No PII, no decisioning.
const TTL_SECONDS = 60 * 60;

export async function GET() {
  const secret = process.env.TURN_STATIC_AUTH_SECRET;
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (!secret || !turnUrl) {
    // No TURN relay configured — callers (useCallRoom.ts) treat a 404 here
    // as "STUN only," the same behavior as before this feature existed.
    return NextResponse.json({ error: "TURN relay not configured." }, { status: 404 });
  }

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}:videopd`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");

  return NextResponse.json({ urls: turnUrl, username, credential, ttl: TTL_SECONDS });
}
