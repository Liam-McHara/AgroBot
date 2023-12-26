import { Context } from "telegraf";
import { Update, Message } from "@telegraf/types";
import { message } from "telegraf/filters"
import { createUser } from "./createUser"
import { bot } from './botInstance';
import { sendTempMsg } from "./sendTempMsg";

const registerWord = "enregistra'm";

export async function botInitHandlers() {
	console.log("Initializing bot handlers...");

	bot.start((ctx: Context<Update>) => {
		if ('message' in ctx.update && ctx.update.message) {
			const message: Message = ctx.update.message;
			ctx.deleteMessage();
			return ctx.reply(`Hello, ${message.from.first_name}!`);
		}
	})

	bot.hears(registerWord, async (ctx: Context) => {
		await createUser(ctx.message.from.id, ctx.message.from.username);
		ctx.deleteMessage();
	});
	bot.on("message", async (ctx: Context) => {
		if (!("text" in ctx.message))
			return;
		const senderId = ctx.message.from.id;
		const msgText = ctx.message.text;
		const name = ctx.message.from.username || ctx.message.from.first_name;
		console.log(`${name} (${senderId}) says:\n\t${msgText}`);
		ctx.deleteMessage()
	});

	// Button actions
	bot.action("offer", (ctx: Context) => {
		console.log("offer btn pressed");
		ctx.answerCbQuery();
		sendTempMsg(ctx.from.id, "TODO: Create new offer.");
	});

	bot.action("order", (ctx: Context) => {
		console.log("order btn pressed");
		ctx.answerCbQuery();
		sendTempMsg(ctx.from.id, "TODO: Create new order.");
	})


	console.log("Handlers ready ✔");
}