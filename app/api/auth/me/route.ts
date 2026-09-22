import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ user: null });
  const rows = await sql`SELECT id,name,upi_id AS upi,mobile,email FROM users WHERE id=${id} LIMIT 1`;
  return NextResponse.json({ user: rows[0] || null });
}