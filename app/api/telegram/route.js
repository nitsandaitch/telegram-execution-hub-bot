import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    throw new Error(`Telegram ${method} failed`);
  }
  return data.result;
}

async function reply(chatId, text) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text: String(text || "בוצע.").slice(0, 3900),
    disable_web_page_preview: true
  });
}

function parseMcp(text, contentType) {
  if (!text) return null;
  if (contentType.includes("application/json")) return JSON.parse(text);

  const lines = text.split("\n").filter((line) => line.startsWith("data:"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i].slice(5).trim());
    } catch {}
  }
  throw new Error("Could not parse MCP response");
}

async function mcpCall(body, sessionId) {
  const url = process.env.EXECUTION_HUB_MCP_URL;
  const token = process.env.EXECUTION_HUB_MCP_TOKEN;
  if (!url) throw new Error("EXECUTION_HUB_MCP_URL missing");
  if (!token) throw new Error("EXECUTION_HUB_MCP_TOKEN missing");

  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store"
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Execution Hub HTTP ${res.status}`);

  return {
    data: parseMcp(raw, res.headers.get("content-type") || ""),
    sessionId: res.headers.get("mcp-session-id") || sessionId
  };
}

async function executionTool(name, args = {}) {
  const init = await mcpCall({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "telegram-execution-hub-bot", version: "1.0.0" }
    }
  });

  const sessionId = init.sessionId;

  try {
    await mcpCall({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }, sessionId);
  } catch {}

  const out = await mcpCall({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args }
  }, sessionId);

  const textPart = out.data?.result?.content?.find((x) => x?.type === "text")?.text;
  if (!textPart) return out.data?.result || {};
  try { return JSON.parse(textPart); } catch { return { text: textPart }; }
}

function formatToday(d) {
  const lines = ["היום"];
  const schedule = d?.schedule || [];
  const tasks = (d?.tasks_today || []).filter((t) => !["done","canceled"].includes(t.status));
  const overdue = d?.overdue_tasks || [];

  if (schedule.length) {
    lines.push("", "לו״ז:");
    for (const x of schedule.slice(0, 8)) {
      const time = x.start_time ? String(x.start_time).slice(0,5) + " " : "";
      lines.push(`• ${time}${x.title}`);
    }
  }

  if (tasks.length) {
    lines.push("", "משימות:");
    for (const t of tasks.slice(0, 8)) lines.push(`• ${t.title}`);
  }

  if (overdue.length) lines.push("", `באיחור: ${overdue.length}`);
  return lines.join("\n");
}

function formatList(title, items, label = "title") {
  if (!Array.isArray(items) || !items.length) return `${title}: אין.`;
  return [title + ":", "", ...items.slice(0,20).map(x => `• ${x[label] || x.name || x.title}`)].join("\n");
}

async function freeCommand(command) {
  switch (command) {
    case "/today":
      return formatToday(await executionTool("get_today", {}));
    case "/tasks": {
      const d = await executionTool("list_tasks", { limit: 20 });
      return formatList("משימות פתוחות", d?.tasks || []);
    }
    case "/week": {
      const d = await executionTool("get_weekly_summary", {});
      return [
        "השבוע",
        "",
        `הושלמו: ${(d?.completed_tasks || []).length}`,
        `באיחור: ${(d?.overdue_tasks || []).length}`,
        `פרויקטים פעילים: ${(d?.projects || []).length}`
      ].join("\n");
    }
    case "/projects": {
      const d = await executionTool("list_projects", { include_all: false });
      return formatList("פרויקטים פעילים", d?.projects || [], "name");
    }
    case "/goals": {
      const d = await executionTool("list_goals", { active_only: true });
      return formatList("יעדים פעילים", d?.goals || [], "name");
    }
    default:
      return null;
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    configured: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      allowedChat: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_ID),
      executionHubUrl: Boolean(process.env.EXECUTION_HUB_MCP_URL),
      executionHubToken: Boolean(process.env.EXECUTION_HUB_MCP_TOKEN),
      openai: Boolean(process.env.OPENAI_API_KEY)
    }
  });
}

export async function POST(req) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const expected = webhookSecret(token || "");
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (!safeEqual(provided, expected)) return new Response("unauthorized", { status: 401 });

    const update = await req.json();
    const chatId = update?.message?.chat?.id;
    const text = update?.message?.text?.trim();
    if (!chatId || !text) return Response.json({ ok: true, ignored: true });

    if (String(chatId) !== String(process.env.TELEGRAM_ALLOWED_CHAT_ID)) {
      return Response.json({ ok: true, ignored: "unauthorized_chat" });
    }

    const cmd = text.split("@")[0];

    if (cmd === "/start" || cmd === "/help") {
      await reply(chatId,
        "פקודות חינמיות:\n/today - היום שלי\n/tasks - משימות פתוחות\n/week - מצב השבוע\n/projects - פרויקטים\n/goals - יעדים\n/status - מצב החיבורים\n/ping - בדיקה"
      );
      return Response.json({ ok: true });
    }

    if (cmd === "/ping") {
      await reply(chatId, "pong");
      return Response.json({ ok: true });
    }

    if (cmd === "/status") {
      await reply(chatId,
        `Telegram: מחובר ✅\nExecution Hub: ${process.env.EXECUTION_HUB_MCP_TOKEN ? "מוגדר ✅" : "חסר אימות"}\nAI: ${process.env.OPENAI_API_KEY ? "מוגדר ✅" : "עדיין לא מחובר"}`
      );
      return Response.json({ ok: true });
    }

    if (cmd.startsWith("/")) {
      const result = await freeCommand(cmd);
      if (result) {
        await reply(chatId, result);
        return Response.json({ ok: true, route: "free" });
      }
    }

    await reply(chatId, "טקסט חופשי יחובר ל-AI בשלב הבא.");
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error?.message || "unknown_error" }, { status: 500 });
  }
}
