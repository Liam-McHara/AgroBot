import mongoose, { Document } from 'mongoose';

interface IUser extends Document {
	tgId: number;
	name: string;
	offers: IOffer[];
	mainMsgId?: number;
	setOffer: (productName: string, amount: number) => Promise<void>;
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

// Sets the offer to the database, adding, editing or removing it accordingly.
userSchema.methods.setOffer = async function (productName: string, amount: number) {
	try {
		if (amount < 1) {
			return await this.removeOffer(productName);
		}
		const existingOffer =
			this.offers.find((offer: IOffer) => offer.productName === productName);
		if (existingOffer) {
			existingOffer.amount = amount;
		} else {
			this.offers.push({ productName, amount });
		}
		await this.save();
		return true;
	} catch (e) {
		console.error("Error adding offer:" + e);
		return false;
	}
}

userSchema.methods.removeOffer = async function (productName: string) {
	console.log(`Removing offer ${productName}...`)
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

const User = mongoose.model<IUser>("User", userSchema)
export { IUser, User, IOffer };