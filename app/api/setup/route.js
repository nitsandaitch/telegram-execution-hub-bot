import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookSecret(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function GET(req) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return Response.json({ ok: false, error: "TELEGRAM_BOT_TOKEN missing" }, { status: 500 });
    }

    const origin = new URL(req.url).origin;
    const webhookUrl = `${origin}/api/telegram`;

    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret(token),
        drop_pending_updates: true,
        allowed_updates: ["message"]
      }),
      cache: "no-store"
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      return Response.json({ ok: false, webhookUrl, telegram: result }, { status: 500 });
    }

    return Response.json({ ok: true, webhookUrl, telegram: result });
  } catch (error) {
    return Response.json({ ok: false, error: error?.message || "unknown_error" }, { status: 500 });
  }
}
