import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUserId } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function PATCH(req: Request) {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { name, upi, mobile, email, password } = await req.json();
    const normalizedEmail=String(email||"").trim().toLowerCase(), normalizedUpi=String(upi||"").trim().toLowerCase(), normalizedMobile=String(mobile||"").replace(/\D/g,"");
    if (!name?.trim() || !normalizedUpi || !normalizedMobile || !normalizedEmail) return NextResponse.json({error:"All profile fields are required"},{status:400});
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || !/^[6-9]\d{9}$/.test(normalizedMobile)) return NextResponse.json({error:"Enter valid profile details"},{status:400});
    const conflict=await sql`SELECT id FROM users WHERE (email=${normalizedEmail} OR upi_id=${normalizedUpi} OR mobile=${normalizedMobile}) AND id<>${id} LIMIT 1`;
    if(conflict.length) return NextResponse.json({error:"Email, UPI ID or mobile number is already in use"},{status:409});
    const passwordHash = password?.trim() ? await bcrypt.hash(password.trim(),12) : null;
    const rows=passwordHash ? await sql`UPDATE users SET name=${name.trim()},upi_id=${normalizedUpi},mobile=${normalizedMobile},email=${normalizedEmail},password_hash=${passwordHash},updated_at=NOW() WHERE id=${id} RETURNING id,name,upi_id,mobile,email` : await sql`UPDATE users SET name=${name.trim()},upi_id=${normalizedUpi},mobile=${normalizedMobile},email=${normalizedEmail},updated_at=NOW() WHERE id=${id} RETURNING id,name,upi_id,mobile,email`;
    return NextResponse.json({user:rows[0]});
  } catch(error){console.error(error);return NextResponse.json({error:"Unable to update profile"},{status:500});}
}