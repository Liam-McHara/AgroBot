import { bot } from "./globals";
import { IUser } from "./models/User";

// Sends a notification to both the product recipient and the producer
// regarding the new order of 'amount' 'productName'.
export async function notifyNewOrder(recipient: IUser, producer: IUser, productName: string, amount: number) {
	const recipientMsg = `ℹ Has demanat <b>${productName} (${amount})</b> a <a href="tg://user?id=${producer.tgId}">${producer.name}</a>`;
	const producerMsg = `🔔 <a href="tg://user?id=${recipient.tgId}">${recipient.name}</a> t'ha demanat <b>${productName} (${amount})</b>`;
	sendNotification(recipient.tgId, recipientMsg);
	sendNotification(producer.tgId, producerMsg);
}

function sendNotification(tgId: number, text: string) {
	bot.telegram.sendMessage(tgId, text, { parse_mode: "HTML" });
}