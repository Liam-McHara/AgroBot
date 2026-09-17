# AgroBot 1.0 (legacy)

This folder holds the original AgroBot prototype, frozen as it was before the 2.0 rebuild.
It is kept for reference only. **Do not extend it.** New work happens in the 2.0 workspace
described in [`../docs/README.md`](../docs/README.md).

What it was, in one paragraph: a Telegram bot (Telegraf 4 + Mongoose/MongoDB, TypeScript,
Catalan UI) where registered users published surplus with `/o <product> <amount>`, saw
everyone's offers in a "main message" that the bot re-sent to every user on every change,
and ordered through a three-step inline-keyboard wizard. A detailed review of what worked
and what did not is in [`../docs/legacy-review.md`](../docs/legacy-review.md).

## Running it (if you ever need to)

```bash
cd legacy
npm install
# .env needs: BOT_TOKEN, MONGODB, TEST_ID
npx tsc && node index.js
```

`netlify/functions/update.ts` is an unfinished attempt at moving the bot to a webhook on
Netlify Functions; it only answers `/start` and is not wired to the rest of the code.
