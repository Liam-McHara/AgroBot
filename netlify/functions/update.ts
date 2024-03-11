import { run } from "../..";

exports.handler = async (event) => {
	const logMsg = `Received an update from Telegram! : ${event?.body}`;
	console.log(logMsg);
	try {
		return { statusCode: 200, body: logMsg };
	} catch (error) {
		console.error(error);
		return { statusCode: 500, body: 'Internal Server Error' };
	}
}

run();