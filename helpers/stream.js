const { Client, Invite, User, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')

class StreamManager {
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
	 * Creates Activity Invite in the voice channel
	 *
	 * @param {VoiceChannel} voiceChannel - voice channel
	 * @param {User} user - user
	 *
	 * @returns {string}
	 */
	async streamInvite(voiceChannel, user) {
		try {
			console.log('Generating stream invite code.')

			/** @param {Invite} response - response */
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