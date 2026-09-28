import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { setSession } from "@/lib/auth";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const clientKey = (req: Request, email: string) => `${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"}:${email}`;
const limited = (key: string) => { const now=Date.now(); const c=loginAttempts.get(key); if (!c || c.resetAt<=now) { loginAttempts.set(key,{count:1,resetAt:now+LOGIN_WINDOW_MS}); return false; } c.count++; return c.count>LOGIN_MAX_ATTEMPTS; };

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  try {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !password) {
      return NextResponse.json({ error: "Invalid email address or password" }, { status: 401 });
    }

    if (limited(clientKey(req, email))) return NextResponse.json({ error: "Too many login attempts. Please try again later." }, { status: 429, headers: { "Retry-After": "900" } });
    const rows = await sql`SELECT id,name,upi_id AS upi,mobile,email,password_hash FROM users WHERE email=${email} LIMIT 1`;
    const passwordMatches = await bcrypt.compare(password, rows[0]?.password_hash || DUMMY_HASH);
    if (!rows.length || !passwordMatches) return NextResponse.json({ error: "Invalid email address or password" }, { status: 401 });
    await setSession(rows[0].id);
    const { password_hash, ...user } = rows[0];
    return NextResponse.json({ user });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to log in" }, { status: 500 }); }
}