import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function PATCH(req: Request) {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { currentPassword, newPassword } = await req.json();
    const current = String(currentPassword || "").trim();
    const next = String(newPassword || "").trim();
    if (!current) return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    if (!next) return NextResponse.json({ error: "New password is required" }, { status: 400 });
    if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    if (current === next) return NextResponse.json({ error: "New password must be different from your current password" }, { status: 400 });
    const rows = await sql`SELECT password_hash FROM users WHERE id=${id} LIMIT 1`;
    if (!rows.length || !(await bcrypt.compare(current, rows[0].password_hash))) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    const passwordHash = await bcrypt.hash(next, 12);
    await sql`UPDATE users SET password_hash=${passwordHash}, updated_at=NOW() WHERE id=${id}`;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to change password" }, { status: 500 });
  }
}