const { Client, Interaction } = require('discord.js')
const { REST } = require('@discordjs/rest')

class UtilsManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client 
	 */
	client

	/**
	 * @param {REST} rest - rest
	 */
	rest

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - Client
	 * @param {REST} rest - Rest
	 */
	constructor(client, rest) {
		this.client = client
		this.rest = rest
	}

	// MARK: - Functions
	/**
	 * Flip a coin.
	 * 
	 * @param {Interaction} interaction - interaction
	 */
	flipCoin(interaction) {
		return interaction.reply({
			content: Math.floor(Math.random() * 2) == 0 ? 'Heads.' : 'Tails.'
		})
	}
}

module.exports = {
	UtilsManager: UtilsManager
}