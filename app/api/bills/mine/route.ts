import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

async function ensurePaymentColumns() {
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bill_recipients ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)`;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    await ensurePaymentColumns();
    const bills = await sql`SELECT b.id,b.created_at AS "createdAt",b.total_amount AS "totalAmount",b.payment_status AS "paymentStatus",
      b.paid_at AS "paidAt",u.name AS "creatorName",u.upi_id AS "creatorUpi"
      FROM bills b JOIN users u ON u.id=b.creator_id
      WHERE b.creator_id=${userId} ORDER BY b.created_at DESC`;
    const result = [];
    for (const bill of bills) {
      const items = await sql`SELECT id,item_name AS name,amount FROM bill_items WHERE bill_id=${bill.id} ORDER BY id`;
      const recipients = await sql`SELECT u.id,u.name,u.upi_id AS upi,br.amount FROM bill_recipients br JOIN users u ON u.id=br.user_id WHERE br.bill_id=${bill.id} ORDER BY u.name`;
      result.push({ ...bill, items, recipients });
    }
    return NextResponse.json({ bills: result });
  } catch (error) {
    console.error("My bills GET error:", error);
    return NextResponse.json({ error: "Unable to load your bills" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    await ensurePaymentColumns();
    const { billId, paymentStatus } = await req.json();
    if (!billId || !["pending", "received"].includes(paymentStatus)) {
      return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
    }
    const found = await sql`SELECT id FROM bills WHERE id=${billId} AND creator_id=${userId} LIMIT 1`;
    if (!found.length) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    await sql`UPDATE bills SET payment_status=${paymentStatus},
      paid_at=${paymentStatus === "received" ? sql`COALESCE(paid_at,NOW())` : sql`NULL`}
      WHERE id=${billId} AND creator_id=${userId}`;
    return NextResponse.json({ success: true, paymentStatus });
  } catch (error) {
    console.error("My bill status error:", error);
    return NextResponse.json({ error: "Unable to update payment status" }, { status: 500 });
  }
}
