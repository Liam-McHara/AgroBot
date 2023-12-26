import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
	throw new Error("BOT_TOKEN is not defined in your environment variables");
}

export const bot = new Telegraf(botToken);

export async function botStart() {
  bot.launch();
  console.log("The bot is now running.");

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}