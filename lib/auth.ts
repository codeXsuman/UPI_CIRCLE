import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "change-this-auth-secret");
const COOKIE = "upi_circle_session";

let accountStatusSchemaReady: Promise<void> | null = null;

export async function ensureAccountStatusSchema() {
  if (!accountStatusSchemaReady) {
    accountStatusSchemaReady = sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`
      .then(() => undefined)
      .catch(error => {
        accountStatusSchemaReady = null;
        throw error;
      });
  }
  await accountStatusSchemaReady;
}

export async function setSession(userId: string) {
  const token = await new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
}

export async function getSessionUserId() {
  try { await ensureAccountStatusSchema(); } catch { return null; }
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch { return null; }
}

export async function clearSession() { (await cookies()).delete(COOKIE); }
