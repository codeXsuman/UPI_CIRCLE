import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

async function ensureHistoryTable() {
  // Use a separate lightweight table so existing bill schemas remain untouched.
  // IDs are stored as text to work with either UUID/text database schemas.
  await sql`
    CREATE TABLE IF NOT EXISTS saved_bill_history (
      bill_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensureHistoryTable();
    const bills = await sql`
      SELECT h.bill_id AS id, h.saved_at AS "savedAt",
             b.total_amount AS "totalAmount",
             u.name AS "creatorName", u.upi_id AS "creatorUpi"
      FROM saved_bill_history h
      JOIN bills b ON b.id = h.bill_id
      JOIN users u ON u.id = b.creator_id
      WHERE h.user_id = ${userId}
      ORDER BY h.saved_at DESC
    `;

    const result = [];
    for (const bill of bills) {
      const items = await sql`
        SELECT id, item_name AS name, amount
        FROM bill_items
        WHERE bill_id = ${bill.id}
        ORDER BY id
      `;
      const recipients = await sql`
        SELECT u.id, u.name, u.upi_id AS upi
        FROM bill_recipients br
        JOIN users u ON u.id = br.user_id
        WHERE br.bill_id = ${bill.id}
        ORDER BY u.name
      `;
      result.push({ ...bill, items, recipients });
    }

    return NextResponse.json({ bills: result });
  } catch (error) {
    console.error("History GET error:", error);
    return NextResponse.json({ error: "Unable to load bill history" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { billId } = await req.json();
    if (!billId) return NextResponse.json({ error: "Bill ID is required" }, { status: 400 });

    await ensureHistoryTable();

    const bill = await sql`
      SELECT id FROM bills
      WHERE id = ${billId} AND creator_id = ${userId}
      LIMIT 1
    `;

    if (!bill.length) {
      return NextResponse.json({ error: "Bill not found or you are not the bill creator" }, { status: 404 });
    }

    await sql`
      INSERT INTO saved_bill_history (bill_id, user_id)
      VALUES (${String(billId)}, ${String(userId)})
      ON CONFLICT (bill_id) DO NOTHING
    `;

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("History POST error:", error);
    return NextResponse.json({ error: "Unable to save bill in history" }, { status: 500 });
  }
}
