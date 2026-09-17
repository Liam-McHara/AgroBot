import { User } from './models/User';
import { getOffersText } from './getOffersText';
import { setMainMsg } from './setMainMsg';
import { msgs } from './msgs';

export async function updateAllMainMsgs() {
	console.log("Updating all main messages...");
	const users = await User.find();
	let text = getOffersText(users);
	if (!text || text.length === 0)
		text = msgs.mainMsgEmpty;
	users.forEach(user => {
		setMainMsg(user, text);
	})
	console.log(text);
};