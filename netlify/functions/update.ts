import { Telegraf } from "telegraf"

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.start(ctx => {
  console.log("Received /start command")
  try {
    return ctx.reply("Hi")
  } catch (e) {
    console.error("error in start action:", e)
    return ctx.reply("Error occured")
  }
})

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