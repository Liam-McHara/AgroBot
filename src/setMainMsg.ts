import { Markup, Telegraf } from 'telegraf';
import { bot } from './botInstance'
import { IUser } from './models/User'

const keyboard = Markup.inlineKeyboard([
	Markup.button.callback("Oferir", "offer"),
	Markup.button.callback("Demanar", "order"),
])

const errNotModifiedDescription = "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message"

// Sets the main message for 'user' to the given 'text', either by
// creating a new one or updating the existing one (if any).
async function setMainMsg(user: IUser, text: string): Promise<void> {
	if (!user) {
		console.error("Could not set main message: 'user' is undefined.");
		return ;
	}
	if (user.mainMsgId) {
		try {
			await bot.telegram.editMessageText(user.tgId, user.mainMsgId, undefined, text, { 
				parse_mode: "MarkdownV2", 
				...keyboard
			});
		} catch (err) {
			if (err.response.description !== errNotModifiedDescription)
			{
				console.error('Error updating main message. Sending a new one...'/*, error*/);
				setNewMainMsg(user, text);
			}
		}
	} else {
		await setNewMainMsg(user, text);
	}
}

async function setNewMainMsg(user: IUser, text: string): Promise<void> {
	try {
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