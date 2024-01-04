import { Markup } from 'telegraf';
import { delayedDeleteMsg } from './delayedDeleteMsg';
import { bot } from './globals'
import { InlineKeyboardMarkup } from '@telegraf/types';


// Sends a message to 'chatId' that autodeletes after 'delay' seconds.
export async function sendTempMsg(chatId: number, text: string, delay: number = 15) {
	try {
		const sentMsg = await bot.telegram.sendMessage(chatId, text);
		if (sentMsg)
			delayedDeleteMsg(chatId, sentMsg.message_id, delay);
		else
			console.error("Error: sentMsg undefined");
	} catch (err) {
		console.error("Error sending temp msg:", err);
	}
}

// Sends a message to 'chatId' that autodeletes after 'delay' seconds.
export async function sendTempMsgKeyboard(chatId: number, text: string,
	keyboard: Markup.Markup<InlineKeyboardMarkup>, delay: number = 15) {
	try {
		const sentMsg = await bot.telegram.sendMessage(chatId, text, keyboard);
		if (sentMsg)
			delayedDeleteMsg(chatId, sentMsg.message_id, delay);
		else
			console.error("Error: sentMsg undefined");
	} catch (err) {
		console.error("Error sending temp msg with keyboard:", err);
	}
}