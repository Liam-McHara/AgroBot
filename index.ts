import mongoose from 'mongoose';
import { botInitHandlers } from './src/botInitHandlers';
import { botStart } from './src/botInstance';

import { updateAllMainMsgs } from './src/updateAllMainMsgs';

import dotenv from 'dotenv';
dotenv.config()
const test_tgId = process.env.TEST_ID;

async function run() {
	await mongoose.connect(process.env.MONGODB);
	await botInitHandlers();

	updateAllMainMsgs();
	
	botStart();
}

run();
