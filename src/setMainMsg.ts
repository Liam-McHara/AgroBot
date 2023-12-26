import { Markup } from 'telegraf';
import { bot } from './botInstance'
import { IUser } from './models/User'

const keyboard = Markup.inlineKeyboard([
	Markup.button.callback("Oferir", "offer"),
	Markup.button.callback("Demanar", "order"),
])

// Sets the main message for 'user' to the given 'text', either by
// creating a new one or updating the existing one (if any).
async function setMainMsg(user: IUser, text: string): Promise<void> {
	if (!user) {
		console.error('User not found');
		return ;
	}
	if (user.mainMsgId) {
		try {
			// Try to update the existing message
			await bot.telegram.editMessageText(user.tgId, user.mainMsgId, undefined, text, { 
				parse_mode: "MarkdownV2", 
				...keyboard
			});
		} catch (error) {
			console.error('Error updating message:', error);
			// Fallback: Send a new message and update the database
			setNewMainMsg(user, text);
		}
	} else {
		setNewMainMsg(user, text);
	}
}

async function setNewMainMsg(user: IUser, text: string): Promise<void> {
	const sentMessage = await bot.telegram.sendMessage(user.tgId, text, {
		parse_mode: "MarkdownV2",
		...keyboard
	});
	user.mainMsgId = sentMessage.message_id;
	await user.save();
}

export { setMainMsg };