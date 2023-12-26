import { Offer, IOffer } from './models/Offer';
import { IUser } from './models/User';
import { setMainMsg } from './setMainMsg';

async function createMainMsg(user: IUser) {
	console.log("Getting offers...");
	const text = await getOffersText(user);
	console.log(text);
	await setMainMsg(user, text);
};

// TODO: Refactor whole User model to store all offers on it.
async function getOffersText(user: IUser): Promise<string> {
	try {
		// Fetch all offers and populate producer details
		let str: string = "";
		const offers = await Offer.find()
			.select(['productName','amount'])
			.populate('producer').exec();

		// Group offers by producer
		const offersGroupedByProducer: Record<string, IOffer[]> = {};
		offers.forEach(offer => {
			const producerName = (offer.producer as unknown as IUser).name;
			if (!offersGroupedByProducer[producerName]) {
				offersGroupedByProducer[producerName] = [];
			}
			offersGroupedByProducer[producerName].push(offer);
		});

		// Format and print the offers
		Object.keys(offersGroupedByProducer).forEach(producerName => {
			str += `[${producerName}](tg://user?id=${user.tgId}) ofereix:\n`;	// wrong user link
			offersGroupedByProducer[producerName].forEach(offer => {
				str += `\\- ${offer.productName} _\\(${offer.amount}\\)_\n`;
			});
		});
		return (str.trim());
	} catch (err) {
		console.error("Error getting offers text:", err);
	}
}

export { createMainMsg };