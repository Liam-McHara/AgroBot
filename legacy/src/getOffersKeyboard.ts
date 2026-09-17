import { Markup } from "telegraf";
import { User } from "./models/User";
import { InlineKeyboardMarkup } from "@telegraf/types";

export async function getOffersKb1(tgId: number): Promise<
	{ usersAmount: number; keyboard: Markup.Markup<InlineKeyboardMarkup>; }> {

	try {
		const users = await User.find({
			tgId: { $ne: tgId },
			offers: { $not: { $size: 0 } }
		}, 'name');
		const keyboard = Markup.inlineKeyboard(
			users.map(user => {
				return [Markup.button.callback(
					`${user.name}`,
					`select_${user._id}`
				)];
			})
		);
		const usersAmount = users.length;
		return { usersAmount, keyboard }
	} catch (err) {
		console.error("Error getting offer keyboard 1:", err);
	}
}

export async function getOffersKb2(userId: string) {
	try {
		const user = await User.findOne({ _id: userId });
		return Markup.inlineKeyboard(
			user.offers.map(product => {
				return [Markup.button.callback(
					`${product.productName} (${product.amount})`,
					`request_${product._id}`
				)];
			})
		);
	} catch (err) {
		console.error("Error getting offer keyboard 2:", err);
	}
}
