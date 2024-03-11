import { run } from "../..";
import { bot } from "../../src/globals";

run();

exports.handler = async (event) => {
	const logMsg = `Received an update from Telegram! : ${event.body}`;
	console.log(logMsg);
	try {
		bot.handleUpdate(JSON.parse(event.body));
		return { statusCode: 200, body: logMsg };
	} catch (error) {
		console.error(error);
		return { statusCode: 500, body: 'Internal Server Error' };
	}
}