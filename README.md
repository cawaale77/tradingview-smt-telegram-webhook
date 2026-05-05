# TradingView SMT Telegram Webhook

This is a simple Vercel-ready Node.js serverless API for receiving TradingView SMT alert JSON and forwarding the alert to a Telegram group or channel.

It only sends Telegram notifications. It does not execute trades.

## Endpoint

```text
POST /api/tradingview-alert
```

After deployment, your TradingView webhook URL will be:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/tradingview-alert
```

## Environment Variables

Set these in Vercel only. Do not put them in Pine Script or frontend code.

```text
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_group_or_channel_chat_id
WEBHOOK_SECRET=your_shared_tradingview_secret
```

The `secret` field sent by TradingView must match `WEBHOOK_SECRET`.

## Create a Telegram Bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Follow the prompts to choose a bot name and username.
4. Copy the bot token BotFather gives you.
5. Save it as `TELEGRAM_BOT_TOKEN` in Vercel.

## Add the Bot to a Telegram Group

1. Open your Telegram group.
2. Add your bot as a member.
3. Make sure the bot has permission to send messages.
4. Send a test message in the group after adding the bot.

For a Telegram channel, add the bot as an administrator with permission to post messages.

## Get TELEGRAM_CHAT_ID

One common way:

1. Add your bot to the group.
2. Send a message in the group.
3. Open this URL in your browser, replacing the token:

```text
https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
```

4. Look for `chat.id` in the response.
5. Group chat IDs usually look like a negative number, for example `-1001234567890`.
6. Save that value as `TELEGRAM_CHAT_ID` in Vercel.

If you are using a public channel, you can often use the channel username as the chat ID, for example:

```text
@your_channel_username
```

## Add Environment Variables in Vercel

1. Open your project in Vercel.
2. Go to **Settings**.
3. Go to **Environment Variables**.
4. Add:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `WEBHOOK_SECRET`
5. Redeploy the project after adding or changing variables.

## Deploy to Vercel

### Option 1: Vercel Dashboard

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New Project**.
3. Import the repository.
4. Add the environment variables.
5. Deploy.

### Option 2: Vercel CLI

Install and deploy:

```bash
npm i -g vercel
vercel
```

For production:

```bash
vercel --prod
```

## TradingView Setup

1. Add your SMT Pine Script indicator to a chart.
2. Create an alert.
3. Choose the condition that uses `alert()` function calls.
4. Enable **Webhook URL**.
5. Paste:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/tradingview-alert
```

6. Make sure the Pine Script `secret` input matches your Vercel `WEBHOOK_SECRET`.

## Sample Curl Test

```bash
curl -X POST https://YOUR-VERCEL-DOMAIN.vercel.app/api/tradingview-alert \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "CHANGE_ME",
    "signal_type": "BULLISH_SMT",
    "group": "FOREX",
    "main_symbol": "EURUSD",
    "comparison_symbol": "GBPUSD",
    "timeframe": "15m",
    "price": "1.17063",
    "timestamp": "2026-05-05T10:30:00Z",
    "message": "Bullish SMT detected"
  }'
```

Expected successful response:

```json
{
  "success": true,
  "sent": true
}
```

If you send the same `signal_type + group + main_symbol + comparison_symbol + timeframe + timestamp` within 60 seconds, the API will not send it again and will return:

```json
{
  "success": true,
  "sent": false,
  "duplicate": true
}
```

## Telegram Message Format

The backend sends messages like:

```text
🚨 BULLISH SMT DETECTED

Group: FOREX
Main: EURUSD
Comparison: GBPUSD
Timeframe: 15m
Price: 1.17063

Message:
Bullish SMT detected.

Action:
Wait for entry model confirmation.
```

## Security Notes

- Keep `TELEGRAM_BOT_TOKEN` only in backend environment variables.
- Keep `TELEGRAM_CHAT_ID` only in backend environment variables.
- Keep `WEBHOOK_SECRET` in Vercel and in the TradingView Pine Script input.
- Never hardcode secrets in the code.
- Never place the Telegram bot token inside Pine Script.
