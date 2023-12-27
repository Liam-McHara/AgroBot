const { mongoose } = require("mongoose");
import { botInitHandlers } from './src/botInitHandlers';
import { botStart } from './src/botInstance';

import { updateAllMainMsgs } from './src/updateAllMainMsgs';

const test_tgId = 1064621248;

async function run() {
	await mongoose.connect(process.env.MONGODB);
	await botInitHandlers();

	updateAllMainMsgs();
	
	botStart();
}

run();
