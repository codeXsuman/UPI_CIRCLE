import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { setSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { name, upi, mobile, email, password } = await req.json();
    if (!name?.trim() || !upi?.trim() || !mobile?.trim() || !email?.trim() || !password) return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    const normalizedEmail = email.trim().toLowerCase(), normalizedUpi = upi.trim().toLowerCase(), normalizedMobile = mobile.replace(/\D/g, "");
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!/^[6-9]\d{9}$/.test(normalizedMobile)) return NextResponse.json({ error: "Enter a valid 10-digit mobile number" }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    const existing = await sql\`SELECT id FROM users WHERE email=${normalizedEmail} OR upi_id=${normalizedUpi} OR mobile=${normalizedMobile} LIMIT 1\`;
    if (existing.length) return NextResponse.json({ error: "An account with this email, UPI ID or mobile number already exists" }, { status: 409 });
    const id = randomUUID(), passwordHash = await bcrypt.hash(password, 12);
    const rows = await sql\`INSERT INTO users (id,name,upi_id,mobile,email,password_hash) VALUES (${id},${name.trim()},${normalizedUpi},${normalizedMobile},${normalizedEmail},${passwordHash}) RETURNING id,name,upi_id,mobile,email\`;
    await setSession(id);
    return NextResponse.json({ user: rows[0] }, { status: 201 });
  } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to create account" }, { status: 500 }); }
}