import { Order } from "./models/Order";
import { IOffer, IUser } from "./models/User";
import { notifyNewOrder } from "./notifyNewOrder";

export async function createOrder (
	recipient: IUser, producer: IUser, offer: IOffer, amount: number
) {
	try {
		if (!recipient || !producer || !offer || amount < 1)
			throw new Error(`Invalid parameters!\nREC:${recipient?.name} PROD:${producer?.name} OFF:${offer?.productName} amnt:${amount}`);
		amount = amount > offer.amount ? offer.amount : amount;
		await producer.setOffer(offer.productName, offer.amount - amount);
		await Order.create({
			recipient: recipient._id,
			producer: producer._id,
			productId: offer._id,
			amount: amount
		})
		notifyNewOrder(recipient, producer, offer.productName, amount);
	} catch (err) {
		console.error(`Error while creating order:`, err);
	}
}