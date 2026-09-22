import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET() {
  const id=await getSessionUserId();
  if(!id) return NextResponse.json({error:"Not authenticated"},{status:401});
  const rows=await sql`SELECT id,name,upi_id AS upi,mobile,email FROM users WHERE id<>${id} ORDER BY name ASC`;
  return NextResponse.json({members:rows});
}