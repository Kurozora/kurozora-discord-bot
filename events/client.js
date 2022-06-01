const { Client, Constants } = require('discord.js')

/** @param {Client} client - client */
module.exports.registerClientEvents = (client) => {
	/** Runs on every request and logs debug information to the terminal. */
	client.on('debug', console.log)

	/** Runs one when the bot is online. */
	client.once('ready', c => {
		console.log(`🚀 [${c.user.tag}] Running...`)
		client.user.setActivity('https://kurozora.app', { type: Constants.ActivityTypes.PLAYING })
	})

	/** Runs when the bot is added to a server. */
	client.on('guildCreate', guild => {
		console.log(`Someone added my bot, server is named: ${guild.name}`)
	})

	/** Runs once when the bot is reconnecting. */
	client.once('reconnecting', c => {
		console.log(`🔄 [${c.user.tag}] Reconnecting...`)
	})

	/** Runs once when the bot offline. */
	client.once('disconnect', c => {
		console.log(`[${c.user.tag}] Disconnect!`)
	})
};