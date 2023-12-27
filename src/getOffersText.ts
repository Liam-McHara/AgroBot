import { IUser } from './models/User';

export async function getOffersText(users: IUser[]): Promise<string> {
	try {
		let str: string = "";
		users.forEach(producer => {
			if (producer.offers && producer.offers.length > 0) {
				str += `[${producer.name}](tg://user?id=${producer.tgId}) ofereix:\n`;
				producer.offers.forEach(offer => {
					str += `\\- ${offer.productName} _\\(${offer.amount}\\)_\n`;
				});
			}
		});
		return (str.trim());
	} catch (err) {
		console.error("Error getting offers text:", err);
	}
}
