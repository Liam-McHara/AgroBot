import mongoose from 'mongoose';
import { botInitHandlers } from './src/botInitHandlers';
import { botStart } from './src/globals';


export async function run() {
	await mongoose.connect(process.env.MONGODB);
	await botInitHandlers();
	botStart();
}

run();
