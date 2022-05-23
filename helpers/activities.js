const { Client, Invite, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const activities = require('../resources/activities.json')

class ActivityManager {
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
	 * @param {string} activity - activity
     * 
	 * @returns {string}
	 */
	async activityInvite(voiceChannel, activity) {
		try {
			console.log('Generating activity invite code.')

			/** @param {Invite} response - response */
			let response = await this.rest.post(
				Routes.channelInvites(voiceChannel.id),
				{
					body: {
						target_application_id: activities[activity].id,
						target_type: 2,
						temporary: false
					}
				},
			)

			console.log(`Generated activity invite code ${response.code}`)
			return response.code
		} catch (error) {
			console.error(error)
		}
	}
}

module.exports = {
	ActivityManager: ActivityManager
}