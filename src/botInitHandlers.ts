import { Context } from "telegraf";
import { message } from "telegraf/filters"
import { createUser } from "./createUser"
import { bot, orderSteps } from './globals';
import { sendTempMsg, sendTempMsgKeyboard as sendTempMsgKb } from "./sendTempMsg";
import { User } from "./models/User";
import { updateAllMainMsgs } from "./updateAllMainMsgs";
import { msgs } from "./msgs";
import { CallbackQuery } from "@telegraf/types";
import { delayedDeleteMsg } from "./delayedDeleteMsg";
import { getOffersKb1, getOffersKb2 } from "./getOffersKeyboard";
import { createOrder } from "./createOrder";
import { parseOfferInput } from "./parseOfferInput";
import { escapeMarkdownV2 } from "./utils";
import { sendUpdatedMainMsg } from "./sendUpdatedMainMsg";

const registerWord = "registre";

export async function botInitHandlers() {
	console.log("Initializing bot handlers...");

	bot.start(async (ctx: Context, next: Function) => {
		const tgId = ctx.from.id;
		sendTempMsg(tgId, `Hola!`, 30);
		try {
			const user = await User.findOne({ tgId: tgId });
			if (!user)
				sendTempMsg(tgId, msgs.unregistered);
			else {
				sendTempMsg(tgId, msgs.wellcomeBack);
				await sendUpdatedMainMsg(user);
			}
		} catch (err) {
			console.error("Error on /start", err);
		}
		return next();
	})

	bot.command("o", async (ctx: Context, next: Function) => {
		if (!("text" in ctx.message))
			return next();
		const tgId = ctx.from.id;
		const args = parseOfferInput(ctx.message.text);
		if (!args) {
			sendTempMsg(tgId, msgs.offerUsage);
			return next();
		}
		const productName = args.productName;
		const amount = args.amount;
		try {
			const user = await User.findOne({ tgId: tgId });
			await user.setOffer(productName, amount);
			const offer = user.offers.find(offer => offer.productName === productName);
			if (!offer)
				sendTempMsg(tgId, `❌ S'ha eliminat el producte: '${productName}'`);
			else
				sendTempMsg(tgId, `✔ Ara ofereixes: ${productName} (${offer.amount})`);
			updateAllMainMsgs();
		} catch (err) {
			console.error("Error setting offer", err);
			sendTempMsg(tgId, msgs.errorOffering);
		}
		return next();
	});

	bot.on(message("text"), async (ctx: Context, next: Function) => {
		if (!("text" in ctx.message))
			return;
		const tgId = ctx.from.id;
		const msgText = ctx.message.text;
		const name = ctx.message.from.first_name || ctx.message.from.username;
		console.log(`${name} (${tgId}) says:\n\t${msgText}`);
		if (ctx.message.text.toLowerCase().trim() === registerWord.toLowerCase().trim()) {
			await createUser(tgId, escapeMarkdownV2(name));
		}
		return next();
	});

	bot.on(message("text"), async (ctx: Context, next: Function) => {
		if (!("text" in ctx.message))
			return;
		try {
			const tgId = ctx.from.id;
			if (orderSteps[tgId]?.step === 3 ) {
				const amount: number = parseInt(ctx.message.text);
				if (Number.isNaN(amount) || amount < 1)
					sendTempMsg(tgId, `Sisplau, respón només amb un número vàlid.\nQuina quantitat vols?`);
				else {
					// 1. Create order
					const recipient = await User.findOne({ tgId: tgId });
					await createOrder(recipient, orderSteps[tgId].producer, orderSteps[tgId].offer, amount);
					// 2. Delete message
					bot.telegram.deleteMessage(tgId, orderSteps[tgId].msgId);
					// 3. Clear steps
					orderSteps.splice(tgId, 1);
					// 4. Update main msg 
					updateAllMainMsgs();
				}
			}
		} catch (err) {
			console.error("")
		}
		return next();
	});

	bot.on("message", async (ctx: Context) => {
		delayedDeleteMsg(ctx.chat.id, ctx.message.message_id, 3);
	});



	// BUTTON ACTIONS

	bot.action("offer", (ctx: Context) => {
		console.log("offer btn pressed");
		ctx.answerCbQuery(msgs.offerUsage, { show_alert: true });
	});

	bot.action("order", async (ctx) => {
		console.log("order btn pressed");
		const tgId = ctx.chat.id;
		orderSteps[tgId] = { step: 1 }
		const ret = await getOffersKb1(tgId);
		ctx.answerCbQuery();
		if (ret.usersAmount === 0) {
			sendTempMsg(tgId, msgs.orderNoOffers);
		}
		else {
			sendTempMsgKb(tgId, msgs.orderSelectProducer, ret.keyboard, 100);
		}
	})

	bot.on('callback_query', async (ctx) => {
		try {
			const tgId = ctx.from.id;
			const callbackQuery: CallbackQuery = ctx.callbackQuery;
			if (!("data" in callbackQuery) || !("message" in callbackQuery))
				return;
			const msgId = callbackQuery.message.message_id;
			const action = callbackQuery.data;
			if (action.startsWith('select_') && orderSteps[tgId]?.step === 1) {
				const userId = action.split('_')[1];
				const user = await User.findOne({ _id: userId });
				console.log(`Selected user: ${user.name}.`)
				ctx.answerCbQuery();
				orderSteps[tgId] = { step: 2, producer: user, msgId: msgId};
				ctx.editMessageText(
					`Demanant a: ${user.name}\nSelecciona el producte.`,
					await getOffersKb2(userId)
				);
			}
			if (action.startsWith('request_') && orderSteps[tgId]?.step === 2) {
				const offerId = action.split('_')[1];
				const producer = orderSteps[tgId].producer;
				const offer = producer.offers.find(offer => offer._id.equals(offerId));
				console.log("Required product:" + offer.productName);
				orderSteps[tgId].step = 3;
				orderSteps[tgId].offer = offer;
				ctx.answerCbQuery();
				ctx.editMessageText(
					`Demanant a: ${producer.name}\nProducte: ${offer.productName} (${offer.amount})\nQuina quantitat vols?`
				);
			}
		} catch (err) {
			console.error("Error on callback query:", err);
		}
	});

	console.log("Handlers ready ✔");
}
