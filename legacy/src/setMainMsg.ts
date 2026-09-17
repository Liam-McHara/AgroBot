import { Markup, Telegraf } from 'telegraf';
import { bot } from './globals'
import { IUser } from './models/User'

const keyboard = Markup.inlineKeyboard([
	Markup.button.callback("Oferir", "offer"),
	Markup.button.callback("Demanar", "order"),
])

// Sets the main message for 'user' to the given 'text', either by
// creating a new one or updating the existing one (if any).
async function setMainMsg(user: IUser, text: string): Promise<void> {
	if (!user) {
		console.error("Could not set main message: 'user' is undefined.");
		return;
	}
	try {
		if (user.mainMsgId) {
			console.log(`Setting main msg to ${user.name}.`);
			await bot.telegram.deleteMessage(user.tgId, user.mainMsgId)
			.catch(err => console.error(`Could not delete message for ${user.name} `, err));
		}
		await setNewMainMsg(user, text);
	} catch (err) {
		console.error(`Error updating main message for ${user.name}.`, err);
	}
}

async function setNewMainMsg(user: IUser, text: string): Promise<void> {
	try {
		console.log(`Setting new main msg for ${user.name}.`);
		const sentMessage = await bot.telegram.sendMessage(user.tgId, text, {
			parse_mode: "MarkdownV2",
			...keyboard
		});
		user.mainMsgId = sentMessage.message_id;
		await user.save();
	} catch (err) {
		console.error("Error setting new main message:\n", err);
	}
}

export { setMainMsg };