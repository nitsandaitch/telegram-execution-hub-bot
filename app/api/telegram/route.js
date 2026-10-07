import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookSecret(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}

async function reply(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    service: "telegram-execution-hub-bot",
    configured: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      allowedChat: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_ID),
      executionHub: Boolean(process.env.EXECUTION_HUB_MCP_URL),
      openai: Boolean(process.env.OPENAI_API_KEY)
    }
  });
}

export async function POST(req) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const expected = webhookSecret(token || "");
    const provided = req.headers.get("x-telegram-bot-api-secret-token");

    if (!safeEqual(provided, expected)) {
      return new Response("unauthorized", { status: 401 });
    }

    const update = await req.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();

    if (!chatId || !text) {
      return Response.json({ ok: true, ignored: true });
    }

    if (String(chatId) !== String(process.env.TELEGRAM_ALLOWED_CHAT_ID)) {
      return Response.json({ ok: true, ignored: "unauthorized_chat" });
    }

    if (text === "/start") {
      await reply(
        chatId,
        "החיבור לטלגרם עובד.\n\nפקודות זמינות כרגע:\n/ping - בדיקת חיבור\n/status - מצב החיבורים\n\nExecution Hub יחובר בשלב הבא."
      );
      return Response.json({ ok: true });
    }

    if (text === "/ping") {
      await reply(chatId, "pong");
      return Response.json({ ok: true });
    }

    if (text === "/status") {
      const execution = Boolean(process.env.EXECUTION_HUB_MCP_URL);
      const ai = Boolean(process.env.OPENAI_API_KEY);
      await reply(
        chatId,
        `Telegram: מחובר ✅\nExecution Hub: ${execution ? "מחובר ✅" : "עדיין לא מחובר"}\nAI: ${ai ? "מחובר ✅" : "עדיין לא מחובר"}`
      );
      return Response.json({ ok: true });
    }

    await reply(
      chatId,
      "קיבלתי. כרגע ערוץ Telegram פעיל; פקודות Execution Hub והשפה החופשית יופעלו בשלב הבא."
    );
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error?.message || "unknown_error" }, { status: 500 });
  }
}
