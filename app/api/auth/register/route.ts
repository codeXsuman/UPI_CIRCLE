import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { setSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { name, upi, mobile, email, password } = await req.json();

    if (!name?.trim() || !upi?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: "Please complete all required fields" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUpi = upi.trim().toLowerCase();
    const normalizedMobile = (mobile || "").replace(/\D/g, "");

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) {
      return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const existing = await sql`
      SELECT
        EXISTS (SELECT 1 FROM users WHERE email = ${normalizedEmail}) AS email_match,
        EXISTS (SELECT 1 FROM users WHERE upi_id = ${normalizedUpi}) AS upi_match,
        EXISTS (
          SELECT 1 FROM users
          WHERE ${normalizedMobile} <> '' AND mobile = ${normalizedMobile}
        ) AS mobile_match
    `;

    const match = existing[0] as { email_match?: boolean; upi_match?: boolean; mobile_match?: boolean };
    const conflicts = [
      match.email_match ? "email" : null,
      match.upi_match ? "UPI ID" : null,
      match.mobile_match ? "mobile number" : null,
    ].filter(Boolean) as string[];

    if (conflicts.length) {
      return NextResponse.json(
        {
          error: conflicts.length === 1
            ? `An account with this ${conflicts[0]} already exists`
            : "An account already exists with one or more of these details",
          conflict: conflicts.length === 1 ? conflicts[0] : "multiple",
          conflicts,
        },
        { status: 409 }
      );
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    const rows = await sql`
      INSERT INTO users (id, name, upi_id, mobile, email, password_hash)
      VALUES (
        ${id},
        ${name.trim()},
        ${normalizedUpi},
        ${normalizedMobile || null},
        ${normalizedEmail},
        ${passwordHash}
      )
      RETURNING id, name, upi_id AS upi, mobile, email
    `;

    await setSession(id);

    return NextResponse.json({ user: rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error("Registration error:", error);

    // PostgreSQL unique-constraint errors can still happen after the
    // pre-check (for example, if two registrations arrive at the same time).
    // Treat them as a duplicate-account response instead of the vague
    // "Unable to create account" message.
    if (error?.code === "23505") {
      const constraint = String(error?.constraint || "").toLowerCase();
      const conflict = constraint.includes("email")
        ? "email"
        : constraint.includes("upi")
          ? "UPI ID"
          : constraint.includes("mobile")
            ? "mobile number"
            : "email, UPI ID or mobile number";

      return NextResponse.json(
        { error: `An account with this ${conflict} already exists`, conflict },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "We couldn't create your account right now. Please try again." },
      { status: 500 }
    );
  }
}
