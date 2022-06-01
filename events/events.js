const { Client } = require('discord.js')
const { registerClientEvents } = require('./client')
const { registerPlayerEvents } = require('./player')

/** @param {Client} client - client */
module.exports.registerEvents = (client) => {
	registerClientEvents(client)
	registerPlayerEvents(client.player)
}