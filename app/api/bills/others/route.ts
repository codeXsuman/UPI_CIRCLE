import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const bills = await sql`SELECT b.id,b.created_at AS "createdAt",b.total_amount AS "totalAmount",
      b.payment_status AS "paymentStatus",br.amount AS "recipientAmount",u.id AS "creatorId",u.name AS "creatorName",u.upi_id AS "creatorUpi"
      FROM bills b JOIN bill_recipients br ON br.bill_id=b.id
      JOIN users u ON u.id=b.creator_id
      WHERE br.user_id=${userId} ORDER BY b.created_at DESC`;
    const result = [];
    for (const bill of bills) {
      const items = await sql`SELECT id,item_name AS name,amount FROM bill_items WHERE bill_id=${bill.id} ORDER BY id`;
      result.push({ ...bill, items });
    }
    return NextResponse.json({ bills: result });
  } catch (error) {
    console.error("Others bills GET error:", error);
    return NextResponse.json({ error: "Unable to load bills for you" }, { status: 500 });
  }
}
