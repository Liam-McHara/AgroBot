import { User } from './models/User'
import { sendTempMsg } from './sendTempMsg';
import { sendUpdatedMainMsg } from './sendUpdatedMainMsg';

// Tries to create a new user on the database. It sends a greeting to the user on success.
// If the user already exists, notifies the user.
export async function createUser(tgId: number, name: string) {
	try {
		let user = await User.findOne({ tgId: tgId }).exec();
		if (user) {
			await sendTempMsg(tgId, "Ja ets a la llista.");
			return;
		}
		user = await User.create({
			tgId: tgId,
			name: name,
		})
		console.log('New user:\n' + user);
		await sendTempMsg(
			tgId,
			`Hola, ${name}. Benvingut a bord! 😃`);
		await sendUpdatedMainMsg(user);
		// const users = await User.find();
		// let text = getOffersText(users)
		// if (!text || text.length === 0)
		// 	text = msgs.mainMsgEmpty;
		// await setMainMsg(user, text);
	} catch (e) {
		console.error(e.message)
	}
}