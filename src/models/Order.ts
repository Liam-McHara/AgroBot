import mongoose, { Document, Schema, SchemaType } from 'mongoose';
import { IOffer, IUser, User } from './User';
import { notifyNewOrder } from '../notifyNewOrder';

interface IOrder extends Document {
	producer: Schema.Types.ObjectId;
	recipient: Schema.Types.ObjectId;
	productId: Schema.Types.ObjectId;
	amount: number;
	createOrder: (recipient: IUser, producer: IUser, offer: IOffer, amount: number) => Promise<void>;
}

const orderSchema = new mongoose.Schema({
	recipient: {
		type: Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	producer: {
		type: Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	productId: {
		type: Schema.Types.ObjectId,
		required: true,
	},
	amount: {
		type: Number,
		required: true,
		min: 1
	}
}, { timestamps: true })

const Order = mongoose.model<IOrder>("Order", orderSchema)
export { Order, IOrder };