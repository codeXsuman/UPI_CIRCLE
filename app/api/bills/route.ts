import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

async function ensureAlertColumns() {
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_reference TEXT`;
}

export async function POST(req: Request) {
  const creatorId=await getSessionUserId();
  if(!creatorId) return NextResponse.json({error:"Not authenticated"},{status:401});
  try {
    await ensureAlertColumns();
    const {items,recipientIds,alertBill=false}=await req.json();
    if(!Array.isArray(items)||!items.length||!Array.isArray(recipientIds)||!recipientIds.length) return NextResponse.json({error:"Bill items and recipients are required"},{status:400});
    const clean=items.map((x:any)=>({name:String(x.name||"").trim(),amount:Number(x.amount)}));
    if(clean.some(x=>!x.name||!Number.isFinite(x.amount)||x.amount<=0)) return NextResponse.json({error:"Invalid bill items"},{status:400});
    const recipients=await sql`SELECT id FROM users WHERE id = ANY(${recipientIds}) AND id<>${creatorId}`;
    if(recipients.length!==recipientIds.length) return NextResponse.json({error:"One or more recipients are invalid"},{status:400});
    const total=clean.reduce((s,x)=>s+x.amount,0), billId=randomUUID();
    await sql`INSERT INTO bills(id,creator_id,total_amount,alert_enabled,payment_status) VALUES(${billId},${creatorId},${total.toFixed(2)},${Boolean(alertBill)},${alertBill ? "pending" : "not_applicable"})`;
    for(const item of clean) await sql`INSERT INTO bill_items(id,bill_id,item_name,amount) VALUES(${randomUUID()},${billId},${item.name},${item.amount.toFixed(2)})`;
    for(const id of recipientIds) await sql`INSERT INTO bill_recipients(bill_id,user_id) VALUES(${billId},${id})`;
    return NextResponse.json({billId,total:Number(total.toFixed(2)),alertBill:Boolean(alertBill),paymentStatus:alertBill ? "pending" : "not_applicable"},{status:201});
  } catch(error){console.error(error);return NextResponse.json({error:"Unable to save bill"},{status:500});}
}