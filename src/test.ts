import { bot } from './botInstance'

// Sends a message to 'chatId' that autodeletes after 'delay' seconds.
export async function sendTempMsg(chatId: number, text: string, delay: number) {
	const sentMsg = await bot.telegram.sendMessage(chatId, text);
	setTimeout(() => {
		bot.telegram.deleteMessage(chatId, sentMsg.message_id);
	}, delay * 1000);
}