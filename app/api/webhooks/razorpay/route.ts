import { NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "@/lib/db";

async function ensurePaymentColumns() {
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_reference TEXT`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS razorpay_payment_link_id TEXT`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS razorpay_payment_link_url TEXT`;
}

function validSignature(rawBody: string, signature: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 503 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  if (!signature || !validSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  try {
    await ensurePaymentColumns();
    const payload = JSON.parse(rawBody);
    const event = String(payload?.event || "");

    const link = payload?.payload?.payment_link?.entity || payload?.payload?.payment_link?.entity?.payment_link || {};
    const payment = payload?.payload?.payment?.entity || {};
    const linkId = String(link?.id || payment?.plink_id || "");
    const billId = String(link?.notes?.bill_id || link?.reference_id || "");

    if (!linkId && !billId) return NextResponse.json({ ok: true });

    if (event === "payment_link.paid") {
      if (!billId) return NextResponse.json({ ok: true });

      const bills = await sql`SELECT id,total_amount,razorpay_payment_link_id,payment_status
        FROM bills WHERE id=${billId} AND alert_enabled=TRUE LIMIT 1`;
      if (!bills.length) return NextResponse.json({ ok: true });

      const bill = bills[0];
      if (bill.razorpay_payment_link_id && linkId && bill.razorpay_payment_link_id !== linkId) {
        return NextResponse.json({ error: "Payment link mismatch" }, { status: 400 });
      }

      const expectedPaise = Math.round(Number(bill.total_amount) * 100);
      const paidPaise = Number(payment?.amount ?? link?.amount_paid ?? 0);
      const paymentStatus = String(payment?.status || "").toLowerCase();
      if (paidPaise !== expectedPaise || (paymentStatus && paymentStatus !== "captured")) {
        console.error("Razorpay payment amount/status mismatch", { billId, expectedPaise, paidPaise, paymentStatus });
        return NextResponse.json({ error: "Payment verification mismatch" }, { status: 400 });
      }

      await sql`UPDATE bills
        SET payment_status='paid',
            paid_at=COALESCE(paid_at,NOW()),
            payment_reference=${String(payment?.id || linkId)}
        WHERE id=${billId} AND alert_enabled=TRUE AND payment_status <> 'paid'`;
    } else if (event === "payment_link.expired") {
      if (billId) await sql`UPDATE bills SET payment_status='expired' WHERE id=${billId} AND alert_enabled=TRUE AND payment_status <> 'paid'`;
    } else if (event === "payment_link.cancelled") {
      if (billId) await sql`UPDATE bills SET payment_status='cancelled' WHERE id=${billId} AND alert_enabled=TRUE AND payment_status <> 'paid'`;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}