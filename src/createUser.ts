import { User } from './models/User'
import { sendTempMsg } from './sendTempMsg';

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
	} catch (e) {
		console.error(e.message)
	}
}