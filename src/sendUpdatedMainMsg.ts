import { getOffersText } from "./getOffersText";
import { IUser, User } from "./models/User";
import { msgs } from "./msgs";
import { setMainMsg } from "./setMainMsg";

export async function sendUpdatedMainMsg(user: IUser) {
	const users = await User.find();
	let text = getOffersText(users);
	if (!text || text.length === 0)
		text = msgs.mainMsgEmpty;
	await setMainMsg(user, text);
}