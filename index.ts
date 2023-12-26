const { mongoose } = require("mongoose");
import { botInitHandlers } from './src/botInitHandlers';
import { botStart } from './src/botInstance';
import { createMainMsg } from './src/createMainMsg';

import { User } from './src/models/User';

const test_tgId = 1064621248;

async function run() {
	await mongoose.connect(process.env.MONGODB)
	await botInitHandlers()
	createMainMsg(await User.findOne({ tgId: test_tgId }));
	botStart();
}

run();
