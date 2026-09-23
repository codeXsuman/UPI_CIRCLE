import crypto from "crypto";

const API_BASE = "https://api.razorpay.com/v1";

function getCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }
  return { keyId, keySecret };
}

function authHeader(keyId: string, keySecret: string) {
  return "Basic " + Buffer.from(keyId + ":" + keySecret).toString("base64");
}

export async function createRazorpayPaymentLink(input: {
  amountInPaise: number;
  referenceId: string;
  description: string;
  customer?: { name?: string; email?: string; contact?: string };
}) {
  const { keyId, keySecret } = getCredentials();

  const response = await fetch(API_BASE + "/payment_links", {
    method: "POST",
    headers: {
      Authorization: authHeader(keyId, keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountInPaise,
      currency: "INR",
      accept_partial: false,
      reference_id: input.referenceId,
      description: input.description.slice(0, 2048),
      customer: input.customer,
      notify: { sms: false, email: false },
      reminder_enable: false,
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.description || "Razorpay Payment Link creation failed");
  }

  return {
    id: String(data.id),
    shortUrl: String(data.short_url),
    status: String(data.status),
  };
}

export async function fetchRazorpayPaymentLink(paymentLinkId: string) {
  const { keyId, keySecret } = getCredentials();

  const response = await fetch(API_BASE + "/payment_links/" + encodeURIComponent(paymentLinkId), {
    headers: { Authorization: authHeader(keyId, keySecret) },
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.description || "Razorpay Payment Link lookup failed");
  }
  return data;
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Razorpay webhook secret is not configured");

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = Buffer.from(signature || "", "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
}
