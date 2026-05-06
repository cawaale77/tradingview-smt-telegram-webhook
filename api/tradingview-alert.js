const TELEGRAM_API_BASE = "https://api.telegram.org";
const DUPLICATE_WINDOW_MS = 60 * 1000;
const MAX_CACHE_SIZE = 500;
const TELEGRAM_TIMEOUT_MS = 8000;
const TELEGRAM_MAX_MESSAGE_LENGTH = 3900;

const sentSignals = globalThis.__tradingViewSentSignals || new Map();
globalThis.__tradingViewSentSignals = sentSignals;

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function logInfo(message, details = {}) {
  console.log(message, details);
}

function logError(message, error, details = {}) {
  console.error(message, {
    ...details,
    error: error?.message || String(error),
  });
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

function hasValue(value) {
  return normalizeString(value) !== "";
}

function createHealthPayload() {
  return {
    ok: true,
    service: "tradingview-smt-telegram-webhook",
    hasTelegramBotToken: hasValue(process.env.TELEGRAM_BOT_TOKEN),
    hasTelegramChatId: hasValue(process.env.TELEGRAM_CHAT_ID),
    hasWebhookSecret: hasValue(process.env.WEBHOOK_SECRET),
  };
}

function logUnauthorizedSecret(receivedSecret, expectedSecret) {
  console.warn("Webhook secret validation failed", {
    receivedSecretLength: receivedSecret.length,
    expectedSecretLength: expectedSecret.length,
    hasReceivedSecret: receivedSecret !== "",
    hasExpectedWebhookSecret: expectedSecret !== "",
  });
}

function logSecretValidation(receivedSecret, expectedSecret, isValid) {
  logInfo("Webhook secret validation result", {
    valid: isValid,
    receivedSecretLength: receivedSecret.length,
    expectedSecretLength: expectedSecret.length,
    hasReceivedSecret: receivedSecret !== "",
    hasExpectedWebhookSecret: expectedSecret !== "",
  });
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

function clampTelegramMessage(text) {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return text;
  }

  logInfo("Telegram message truncated", {
    originalLength: text.length,
    maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
  });

  return `${text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 32)}\n\n[Message truncated]`;
}

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  const safeText = clampTelegramMessage(text);

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: safeText,
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json().catch(() => null);
    const details = data?.description || response.statusText || "Unknown Telegram API response";

    logInfo("Telegram API response", {
      ok: response.ok,
      status: response.status,
      hasDescription: typeof data?.description === "string",
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        details,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    const details = error?.name === "AbortError" ? "Telegram API request timed out" : error.message;

    logError("Telegram API request failed", error, {
      status: null,
    });

    return {
      ok: false,
      status: null,
      details,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  try {
    logInfo("TradingView webhook request received", {
      method: req.method,
      hasBody: req.body !== undefined && req.body !== null,
    });

    if (req.method === "GET") {
      return sendJson(res, 200, createHealthPayload());
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(res, 405, {
        success: false,
        error: "Method Not Allowed",
      });
    }

    const webhookSecret = normalizeString(process.env.WEBHOOK_SECRET);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!webhookSecret || !botToken || !chatId) {
      logInfo("Server environment validation failed", {
        hasWebhookSecret: webhookSecret !== "",
        hasTelegramBotToken: Boolean(botToken),
        hasTelegramChatId: Boolean(chatId),
      });

      return sendJson(res, 500, {
        success: false,
        sent: false,
        error: "Server is missing required environment variables",
      });
    }

    let body = {};

    if (typeof req.body === "string") {
      try {
        body = JSON.parse(req.body);
      } catch {
        logInfo("Invalid JSON body received");

        return sendJson(res, 400, {
          success: false,
          sent: false,
          error: "Invalid JSON body",
        });
      }
    } else if (typeof req.body === "object" && req.body !== null) {
      body = req.body;
    }

    const missingFields = getMissingFields(body);

    logInfo("Required field validation result", {
      ok: missingFields.length === 0,
      missingFields,
    });

    if (missingFields.length > 0) {
      return sendJson(res, 400, {
        success: false,
        sent: false,
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

    const secretIsValid = body.secret === webhookSecret;
    logSecretValidation(body.secret, webhookSecret, secretIsValid);

    if (!secretIsValid) {
      logUnauthorizedSecret(body.secret, webhookSecret);

      return sendJson(res, 401, {
        success: false,
        sent: false,
        error: "Unauthorized",
        hint: "Check TradingView indicator Webhook secret and Vercel WEBHOOK_SECRET",
      });
    }

    if (!["BULLISH_SMT", "BEARISH_SMT"].includes(body.signal_type)) {
      return sendJson(res, 400, {
        success: false,
        sent: false,
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
    const telegramResult = await sendTelegramMessage(telegramMessage);

    if (!telegramResult.ok) {
      return sendJson(res, 200, {
        success: false,
        sent: false,
        error: "Telegram API failed",
        details: telegramResult.details,
      });
    }

    sentSignals.set(signalKey, now);

    return sendJson(res, 200, {
      success: true,
      sent: true,
    });
  } catch (error) {
    logError("Unhandled TradingView webhook error", error);

    return sendJson(res, 500, {
      success: false,
      sent: false,
      error: "Internal server error",
      details: error.message,
    });
  }
};
