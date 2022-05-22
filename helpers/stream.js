const { Invite } = require('discord.js');
const { Routes } = require('discord-api-types/v9')

class StreamManager {
	// MARK: - Properties
	client
	rest

	// MARK: - Initializers
	/**
	 * @constructor
	 * @param {Client} client - Client
	 * @param {REST} rest - Rest
	 */
	constructor(client, rest) {
		this.client = client
		this.rest = rest
	}

	// MARK: - Functions
	/**
	 * Creates Activity Invite in the voice channel
	 * @param {string} Application
	 * @returns {Invite}
	 */
	async streamInvite(voiceChannel, user) {
		try {
			console.log('Generating stream invite code.')

			let response = await this.rest.post(
				Routes.channelInvites(voiceChannel.id),
				{
					body: {
						target_user_id: user.id,
						target_type: 1,
						temporary: false
					}
				},
			)

			console.log(`Generated stream invite code ${response.code}`)
			return response.code
		} catch (error) {
			console.error(error)
		}
	}
}

module.exports = {
	StreamManager: StreamManager
}