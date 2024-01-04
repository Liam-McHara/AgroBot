import { bot } from "./globals";

// Deletes the message from 'ctx' after 'delay' seconds.
export async function delayedDeleteMsg(chatId: number, msgId: number, delay: number = 10) {
	console.log(`deleting message ${msgId} after ${delay}s...`);
	setTimeout(async () => {
		try {
			await bot.telegram.deleteMessage(chatId, msgId);
		} catch (err) {
			console.error("Error deleting with delay:", err);
		}
	}, delay * 1000);
}
