import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

async function ensurePaymentColumns() {
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_reference TEXT`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS razorpay_payment_link_id TEXT`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS razorpay_payment_link_url TEXT`;
}

async function createRazorpayPaymentLink(args: {
  billId: string;
  total: number;
  description: string;
}) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay server credentials are not configured");

  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      upi_link: true,
      amount: Math.round(args.total * 100),
      currency: "INR",
      accept_partial: false,
      reference_id: args.billId,
      description: args.description.slice(0, 2048),
      notes: { bill_id: args.billId },
      reminder_enable: false,
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok || !data.id || !data.short_url) {
    console.error("Razorpay Payment Link error:", data);
    throw new Error("Unable to create Razorpay payment link");
  }
  return { id: String(data.id), url: String(data.short_url) };
}

export async function POST(req: Request) {
  const creatorId = await getSessionUserId();
  if (!creatorId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensurePaymentColumns();
    const { items, recipientIds, alertBill = false } = await req.json();

    if (!Array.isArray(items) || !items.length || !Array.isArray(recipientIds) || !recipientIds.length) {
      return NextResponse.json({ error: "Bill items and recipients are required" }, { status: 400 });
    }

    const clean = items.map((x: any) => ({ name: String(x.name || "").trim(), amount: Number(x.amount) }));
    if (clean.some((x: any) => !x.name || !Number.isFinite(x.amount) || x.amount <= 0)) {
      return NextResponse.json({ error: "Invalid bill items" }, { status: 400 });
    }

    const recipients = await sql`SELECT id FROM users WHERE id = ANY(${recipientIds}) AND id <> ${creatorId}`;
    if (recipients.length !== recipientIds.length) {
      return NextResponse.json({ error: "One or more recipients are invalid" }, { status: 400 });
    }

    const creatorRows = await sql`SELECT name,email,mobile FROM users WHERE id=${creatorId} LIMIT 1`;
    if (!creatorRows.length) return NextResponse.json({ error: "Creator account not found" }, { status: 404 });

    const total = clean.reduce((sum: number, item: any) => sum + item.amount, 0);
    const billId = randomUUID();
    const useAlert = Boolean(alertBill);

    await sql`INSERT INTO bills(id,creator_id,total_amount,alert_enabled,payment_status)
      VALUES(${billId},${creatorId},${total.toFixed(2)},${useAlert},${useAlert ? "pending" : "not_applicable"})`;

    try {
      for (const item of clean) {
        await sql`INSERT INTO bill_items(id,bill_id,item_name,amount)
          VALUES(${randomUUID()},${billId},${item.name},${item.amount.toFixed(2)})`;
      }
      for (const id of recipientIds) {
        await sql`INSERT INTO bill_recipients(bill_id,user_id) VALUES(${billId},${id})`;
      }

      let paymentLink: { id: string; url: string } | null = null;
      if (useAlert) {
        paymentLink = await createRazorpayPaymentLink({
          billId,
          total,
          description: "UPI Bills — " + clean.map((x: any) => x.name).join(", "),
        });

        await sql`UPDATE bills
          SET razorpay_payment_link_id=${paymentLink.id}, razorpay_payment_link_url=${paymentLink.url}
          WHERE id=${billId}`;
      }

      return NextResponse.json({
        billId,
        total: Number(total.toFixed(2)),
        alertBill: useAlert,
        paymentStatus: useAlert ? "pending" : "not_applicable",
        paymentLinkUrl: paymentLink?.url || null,
      }, { status: 201 });
    } catch (error) {
      console.error("Bill/payment-link creation error:", error);
      await sql`DELETE FROM bills WHERE id=${billId}`;
      const message = useAlert && /Razorpay server credentials/.test(String(error))
        ? "Alert bills need Razorpay server credentials in Vercel first."
        : useAlert
          ? "Unable to create the verified payment link. The bill was not saved."
          : "Unable to save bill";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to save bill" }, { status: 500 });
  }
}