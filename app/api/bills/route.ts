import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

async function ensurePaymentColumns() {
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bill_recipients ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)`;
}

export async function POST(req: Request) {
  const creatorId = await getSessionUserId();
  if (!creatorId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensurePaymentColumns();
    const { items, recipientIds, recipientAmounts = {} } = await req.json();

    if (!Array.isArray(items) || !items.length || !Array.isArray(recipientIds) || !recipientIds.length) {
      return NextResponse.json({ error: "Bill items and recipients are required" }, { status: 400 });
    }

    const uniqueRecipientIds = [...new Set(recipientIds.map((id: unknown) => String(id)))];
    if (uniqueRecipientIds.length !== recipientIds.length) {
      return NextResponse.json({ error: "Each recipient can only be selected once" }, { status: 400 });
    }

    const clean = items.map((x: any) => ({
      name: String(x?.name || "").trim(),
      amount: Number(x?.amount)
    }));

    if (clean.some((x: any) => !x.name || !Number.isFinite(x.amount) || x.amount <= 0)) {
      return NextResponse.json({ error: "Each bill item needs a name and an amount greater than ₹0" }, { status: 400 });
    }

    const totalCents = clean.reduce((sum: number, item: any) => sum + Math.round(item.amount * 100), 0);
    if (totalCents <= 0) {
      return NextResponse.json({ error: "Bill total must be greater than ₹0" }, { status: 400 });
    }

    const recipients = await sql`
      SELECT id
      FROM users
      WHERE id = ANY(${uniqueRecipientIds}) AND id <> ${creatorId}
    `;
    if (recipients.length !== uniqueRecipientIds.length) {
      return NextResponse.json({ error: "One or more selected members are no longer available" }, { status: 400 });
    }

    const hasCustomSplit = uniqueRecipientIds.some((id: string) => String(recipientAmounts?.[id] ?? "").trim() !== "");
    const shares: Record<string, number> = {};

    if (hasCustomSplit) {
      let shareCents = 0;
      for (const id of uniqueRecipientIds) {
        const raw = String(recipientAmounts?.[id] ?? "").trim();
        const value = Number(raw);
        if (!raw || !Number.isFinite(value) || value <= 0) {
          return NextResponse.json({ error: "Enter a valid amount for every selected member, or use Split equally" }, { status: 400 });
        }
        const cents = Math.round(value * 100);
        shares[id] = cents;
        shareCents += cents;
      }
      if (shareCents !== totalCents) {
        return NextResponse.json({ error: "Member shares must add up exactly to the total bill" }, { status: 400 });
      }
    } else {
      const base = Math.floor(totalCents / uniqueRecipientIds.length);
      const remainder = totalCents - base * uniqueRecipientIds.length;
      uniqueRecipientIds.forEach((id: string, index: number) => {
        shares[id] = base + (index === 0 ? remainder : 0);
      });
    }

    const total = totalCents / 100;
    const billId = randomUUID();
    await sql`INSERT INTO bills(id,creator_id,total_amount,payment_status)
      VALUES(${billId},${creatorId},${total.toFixed(2)},${"pending"})`;

    try {
      for (const item of clean) {
        await sql`INSERT INTO bill_items(id,bill_id,item_name,amount)
          VALUES(${randomUUID()},${billId},${item.name},${item.amount.toFixed(2)})`;
      }
      for (const id of uniqueRecipientIds) {
        await sql`INSERT INTO bill_recipients(bill_id,user_id,amount)
          VALUES(${billId},${id},${(shares[id] / 100).toFixed(2)})`;
      }

      return NextResponse.json({
        billId,
        total: Number(total.toFixed(2)),
        paymentStatus: "pending",
      }, { status: 201 });
    } catch (error) {
      console.error("Bill creation error:", error);
      await sql`DELETE FROM bills WHERE id=${billId}`;
      return NextResponse.json({ error: "We couldn't save the bill right now. Please try again." }, { status: 500 });
    }
  } catch (error) {
    console.error("Bill creation request error:", error);
    return NextResponse.json({ error: "We couldn't create the bill right now. Please try again." }, { status: 500 });
  }
}
