import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function PATCH(req: Request) {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { name, upi, mobile, email, password, currentPassword } = await req.json();
    if (!String(currentPassword || "").trim()) return NextResponse.json({error:"Current password is required to save changes"},{status:400});
    const authRows = await sql`SELECT password_hash FROM users WHERE id=${id} LIMIT 1`;
    const storedPasswordHash = authRows[0]?.password_hash;
    if (!storedPasswordHash) return NextResponse.json({error:"This account cannot verify its password. Please contact support."},{status:400});
    const passwordMatches = await bcrypt.compare(String(currentPassword), String(storedPasswordHash));
    if (!passwordMatches) return NextResponse.json({error:"Current password is incorrect"},{status:401});

    const normalizedEmail=String(email||"").trim().toLowerCase();
    const normalizedUpi=String(upi||"").trim().toLowerCase();
    const normalizedMobile=String(mobile||"").replace(/\D/g,"");

    if (!name?.trim() || !normalizedUpi || !normalizedEmail) return NextResponse.json({error:"Name, UPI ID and email are required"},{status:400});
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return NextResponse.json({error:"Enter a valid email address"},{status:400});
    if (normalizedMobile && !/^[6-9]\d{9}$/.test(normalizedMobile)) return NextResponse.json({error:"Enter a valid 10-digit Indian mobile number"},{status:400});

    const conflict=await sql`SELECT id FROM users WHERE (email=${normalizedEmail} OR upi_id=${normalizedUpi} OR (${normalizedMobile} <> '' AND mobile=${normalizedMobile})) AND id<>${id} LIMIT 1`;
    if(conflict.length) return NextResponse.json({error:"Email, UPI ID or mobile number is already in use"},{status:409});

    const passwordHash = password?.trim() ? await bcrypt.hash(password.trim(),12) : null;
    const rows=passwordHash
      ? await sql`UPDATE users SET name=${name.trim()},upi_id=${normalizedUpi},mobile=${normalizedMobile || null},email=${normalizedEmail},password_hash=${passwordHash},updated_at=NOW() WHERE id=${id} RETURNING id,name,upi_id AS upi,mobile,email`
      : await sql`UPDATE users SET name=${name.trim()},upi_id=${normalizedUpi},mobile=${normalizedMobile || null},email=${normalizedEmail},updated_at=NOW() WHERE id=${id} RETURNING id,name,upi_id AS upi,mobile,email`;
    return NextResponse.json({user:rows[0]});
  } catch(error){console.error(error);return NextResponse.json({error:"Unable to update profile"},{status:500});}
}