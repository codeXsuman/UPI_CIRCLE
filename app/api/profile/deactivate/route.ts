import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { clearSession, ensureAccountStatusSchema, getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensureAccountStatusSchema();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword.trim()) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }

    const rows = await sql`SELECT password_hash FROM users WHERE id=${id} AND deactivated_at IS NULL LIMIT 1`;
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    await sql`DELETE FROM bill_recipients WHERE user_id=${id}`;
    await sql`DELETE FROM bill_items WHERE bill_id IN (SELECT id FROM bills WHERE creator_id=${id})`;
    await sql`DELETE FROM bills WHERE creator_id=${id}`;
    await sql`DELETE FROM users WHERE id=${id}`;
    await clearSession();

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Account deactivation error:", error);
    return NextResponse.json({ error: "Unable to deactivate your account right now. Please try again." }, { status: 500 });
  }
}
