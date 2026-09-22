import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { setSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const rows = await sql`SELECT id,name,upi_id,mobile,email,password_hash FROM users WHERE email=${String(email || "").trim().toLowerCase()} LIMIT 1`;
    if (!rows.length || !(await bcrypt.compare(password || "", rows[0].password_hash))) return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    await setSession(rows[0].id);
    const { password_hash, ...user } = rows[0];
    return NextResponse.json({ user });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to log in" }, { status: 500 }); }
}