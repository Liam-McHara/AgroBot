import mongoose, { Document } from 'mongoose';

interface IUser extends Document {
	tgId: number;
	name: string;
	offers: IOffer[];
	mainMsgId?: number;
	addOffer: (productName: string, amount: number) => Promise<void>;
	updateOffer: (productName: string, newAmount: number) => Promise<void>;
	removeOffer: (productName: string) => Promise<void>;
}

interface IOffer extends Document {
	productName: string;
	amount: number;
}

const offerSchema = new mongoose.Schema({
	productName: {
		type: String,
		required: true,
	},
	amount: {
		type: Number,
		required: true,
		min: 1
	}
}, { timestamps: true })

const userSchema = new mongoose.Schema({
	tgId: {
		type: Number,
		unique: true,
		required: true,
	},
	name: {
		type: String,
		unique: true,
		required: true,
	},
	offers: [offerSchema],
	mainMsgId: Number,
}, { timestamps: true })

// Adds the offer to the database. If there is an existing offer of the same
// product, updates its amount.
userSchema.methods.addOffer = async function (productName: string, amount: number) {
	try {
		if (amount < 1)
			throw new Error("amount must be > 0");
		const existingOffer =
			this.offers.find((offer: IOffer) => offer.productName === productName);
		if (existingOffer) {
			existingOffer.amount += amount;
		} else {
			this.offers.push({ productName, amount });
		}
		await this.save();
	} catch (e) {
		console.error("Error adding offer:" + e);
	}
}

userSchema.methods.removeOffer = async function (productName: string) {
	try {
		const offerIndex =
			this.offers.findIndex((offer: IOffer) => offer.productName === productName);

		if (offerIndex > -1) {
			this.offers.splice(offerIndex, 1);
			await this.save();
			return true;
		} else {
			return false;
		}
	} catch (e) {
		console.error("Error removing offer:" + e);
	}
}

userSchema.methods.updateOffer = async function (productName: string, newAmount: number) {
	const offer = this.offers.find(offer => offer.productName === productName);

	if (offer) {
		offer.amount = newAmount;
		await this.save();
		return true;
	} else {
		return false;
	}
};

const User = mongoose.model<IUser>("User", userSchema)
export { IUser, User, IOffer };