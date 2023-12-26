import mongoose, { Document } from 'mongoose';

interface IOffer extends Document {
	productName: string;
	amount: number;
	producer: mongoose.Schema.Types.ObjectId;
	updateAmount: (amountMod: number) => Promise<void>;
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
  },
  producer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }
}, { timestamps: true })

// Updates the amount of the offer, adding/substracting its value.
// If the new value is 0, removes the offer from the database.
// If the new value is < 0, throws an error.
offerSchema.methods.updateAmount = async function(amountMod: number) {
	const newAmount = this.amount + amountMod;
	if (newAmount < 0)
		throw new Error("ERROR: New amount value cannot go below 0.");
	if (newAmount == 0)
		await this.remove();
	else {
		this.amount = newAmount;
		await this.save();
	}
}

const Offer = mongoose.model<IOffer>("Offer", offerSchema);
export { Offer, IOffer };