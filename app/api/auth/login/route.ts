import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { setSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !/^\\S+@\\S+\\.\\S+$/.test(email) || email.length > 254 || !password) {
      return NextResponse.json({ error: "Invalid email address or password" }, { status: 401 });
    }

    const rows = await sql`SELECT id,name,upi_id AS upi,mobile,email,password_hash FROM users WHERE email=${email} LIMIT 1`;
    if (!rows.length || !(await bcrypt.compare(password || "", rows[0].password_hash))) return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    await setSession(rows[0].id);
    const { password_hash, ...user } = rows[0];
    return NextResponse.json({ user });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to log in" }, { status: 500 }); }
}