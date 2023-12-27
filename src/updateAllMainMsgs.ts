import { User } from './models/User';
import { getOffersText } from './getOffersText';
import { setMainMsg } from './setMainMsg';

export async function updateAllMainMsgs() {
	console.log("Getting offers...");
	const users = await User.find();
	const text = await getOffersText(users);
	users.forEach(user => {
		setMainMsg(user, text);
	})
	console.log(text);
};