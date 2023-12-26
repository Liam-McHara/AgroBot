import mongoose, { Document } from 'mongoose';

interface IUser extends Document {
	tgId: number;
	name: string;
	mainMsgId?: number;
	getMyOrders: () => Promise<void>;
	getOrdersToMe: () => Promise<void>;
	findByTgId: () => Promise<void>;
}

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
	mainMsgId: Number
}, { timestamps: true })

// Method to retrieve the current orders made by the user.
userSchema.methods.getMyOrders = async function () {
	const Order = this.model('Order');
	const orders = await Order.find({ orderer: this._id }).select('_id');
	return orders.map(orders => orders._id);
}

// Method to retrieve the current orders made to the user.
userSchema.methods.getOrdersToMe = async function () {
	const Order = this.model('Order');
	const orders = await Order.find({ producer: this._id }).select('_id');
	return orders.map(orders => orders._id);
}

userSchema.statics.findByTgId = async function(tgId: number) {
	return this.findOne({ tgId: tgId});
}

const User = mongoose.model<IUser>("User", userSchema)
export { IUser, User };