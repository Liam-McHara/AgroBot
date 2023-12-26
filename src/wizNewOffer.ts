import { Telegraf, Scenes, session } from 'telegraf'

export const wizNewOffer = new Scenes.WizardScene<any>(
	'wizNewOffer',
  (ctx) => {
   ctx.reply("What is your name young one?");
  },
  (ctx) => {
		const answer = ctx.message.text;
		ctx.reply(`So... your name is ${answer}. Is that correct?`);
  },  
)