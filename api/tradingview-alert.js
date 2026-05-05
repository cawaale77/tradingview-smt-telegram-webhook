const TELEGRAM_API_BASE = "https://api.telegram.org";
const DUPLICATE_WINDOW_MS = 60 * 1000;
const MAX_CACHE_SIZE = 500;

const sentSignals = globalThis.__tradingViewSentSignals || new Map();
globalThis.__tradingViewSentSignals = sentSignals;

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function cleanupCache(now) {
  for (const [key, value] of sentSignals.entries()) {
    if (now - value > DUPLICATE_WINDOW_MS) {
      sentSignals.delete(key);
    }
  }

  while (sentSignals.size > MAX_CACHE_SIZE) {
    const oldestKey = sentSignals.keys().next().value;
    sentSignals.delete(oldestKey);
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getMissingFields(body) {
  const requiredFields = [
    "secret",
    "signal_type",
    "group",
    "main_symbol",
    "comparison_symbol",
    "timeframe",
    "price",
    "timestamp",
    "message",
  ];

  return requiredFields.filter((field) => normalizeString(body[field]) === "");
}

function createSignalKey(body) {
  return [
    body.signal_type,
    body.group,
    body.main_symbol,
    body.comparison_symbol,
    body.timeframe,
    body.timestamp,
  ]
    .map(normalizeString)
    .join("|");
}

function formatSignalTitle(signalType) {
  if (signalType === "BULLISH_SMT") {
    return "BULLISH SMT";
  }

  if (signalType === "BEARISH_SMT") {
    return "BEARISH SMT";
  }

  return signalType.replaceAll("_", " ");
}

function formatMessageBody(message) {
  const trimmedMessage = normalizeString(message);
  return /[.!?]$/.test(trimmedMessage) ? trimmedMessage : `${trimmedMessage}.`;
}

function formatTelegramMessage(body) {
  const title = formatSignalTitle(body.signal_type);

  return [
    `🚨 ${title} DETECTED`,
    "",
    `Group: ${body.group}`,
    `Main: ${body.main_symbol}`,
    `Comparison: ${body.comparison_symbol}`,
    `Timeframe: ${body.timeframe}`,
    `Price: ${body.price}`,
    "",
    "Message:",
    formatMessageBody(body.message),
    "",
    "Action:",
    "Wait for entry model confirmation.",
  ].join("\n");
}

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const telegramError = data?.description || response.statusText;
    throw new Error(`Telegram API failed: ${telegramError}`);
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      success: false,
      error: "Method Not Allowed",
    });
  }

  const webhookSecret = process.env.WEBHOOK_SECRET;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!webhookSecret || !botToken || !chatId) {
    return sendJson(res, 500, {
      success: false,
      error: "Server is missing required environment variables",
    });
  }

  let body = {};

  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body);
    } catch {
      return sendJson(res, 400, {
        success: false,
        error: "Invalid JSON body",
      });
    }
  } else if (typeof req.body === "object" && req.body !== null) {
    body = req.body;
  }

  const missingFields = getMissingFields(body);

  if (missingFields.length > 0) {
    return sendJson(res, 400, {
      success: false,
      error: "Missing required fields",
      missing_fields: missingFields,
    });
  }

  body = {
    secret: normalizeString(body.secret),
    signal_type: normalizeString(body.signal_type),
    group: normalizeString(body.group),
    main_symbol: normalizeString(body.main_symbol),
    comparison_symbol: normalizeString(body.comparison_symbol),
    timeframe: normalizeString(body.timeframe),
    price: normalizeString(body.price),
    timestamp: normalizeString(body.timestamp),
    message: normalizeString(body.message),
  };

  if (body.secret !== webhookSecret) {
    return sendJson(res, 401, {
      success: false,
      error: "Unauthorized",
    });
  }

  if (!["BULLISH_SMT", "BEARISH_SMT"].includes(body.signal_type)) {
    return sendJson(res, 400, {
      success: false,
      error: "Invalid signal_type",
    });
  }

  const now = Date.now();
  cleanupCache(now);

  const signalKey = createSignalKey(body);

  if (sentSignals.has(signalKey) && now - sentSignals.get(signalKey) <= DUPLICATE_WINDOW_MS) {
    return sendJson(res, 200, {
      success: true,
      sent: false,
      duplicate: true,
    });
  }

  const telegramMessage = formatTelegramMessage(body);

  try {
    await sendTelegramMessage(telegramMessage);
    sentSignals.set(signalKey, now);

    return sendJson(res, 200, {
      success: true,
      sent: true,
    });
  } catch (error) {
    return sendJson(res, 502, {
      success: false,
      error: error.message,
    });
  }
};
