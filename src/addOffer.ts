import { Offer } from './models/Offer'
import { User } from './models/User'

// Adds the offer to the database. If there is an existing similar offer
// (same producer & same product), updates its amount.
async function addOffer(producerTgId: number, productName: string, amount: number){
	try {
		const producer = await User.findOne({tgId: producerTgId});
		if (!producer)
			throw new Error(`Could not find a user with tgId: ${producerTgId}`);
		const previousOffer = await Offer.findOne({
			productName: productName, 
			producer: producer._id
		});
		if (previousOffer)
			await previousOffer.updateAmount(amount);
		else
			await Offer.create({
				productName: productName,
				amount: amount,
				producer: producer._id 
		})
	} catch (e) {
		console.error("Error on adding offer:" + e);
	}
}
export { addOffer };