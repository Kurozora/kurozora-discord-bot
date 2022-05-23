const { Client, Guild, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { AudioPlayer, createAudioPlayer, joinVoiceChannel, VoiceConnection, createAudioResource } = require('@discordjs/voice');
const ytdl = require("ytdl-core");
const youtubeURLS = require('../resources/urls.json').youtube
// To get the YouTube cookie
// - navigate to YouTube in a web browser
// - open up dev tools (opt+cmd+j on mac)
// - go to the network tab
// - click on a request on the left
// - scroll down to "Request Headers"
// - find the "cookie" header and copy its entire contents
const youtubeCookie = process.env['youtube_cookie']

class MusicManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client
	 */
	client

	/**
	 * @param {REST} rest - rest
	 */
	rest

	/**
	 * @param {VoiceConnection} connection - connection
	 */
	connection

	/**
	 * @param {AudioPlayer} player - player
	 */
	player

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - Client
	 * @param {REST} rest - REST
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
	 * @param {Guild} guild - guild
	 * @param {string} videoLink - video link
	 */
	async queue(voiceChannel, guild, videoLink) {
		try {
			console.log('Downloading YouTube video.')

			var youtubeLink = videoLink
			var isURL = false

			for (const youtubeURL of youtubeURLS) {
				isURL = youtubeLink.includes(youtubeURL)

				if (isURL) {
					break
				}
			}

			youtubeLink = isURL ? youtubeLink : `https://www.youtube.com/watch?v=${youtubeLink}`

			const stream = ytdl(youtubeLink, {
				filter: 'audio',
				requestOptions: {
					headers: {
	      				cookie: youtubeCookie,
					}
				}
			});
			const audioResource = createAudioResource(stream)
			this.player = createAudioPlayer()
			this.player.play(audioResource)
			
			this.connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: guild.id,
				adapterCreator: guild.voiceAdapterCreator,
				selfDeaf: true
			}).subscribe(this.player)

			console.log('Playing YouTube video.')
		} catch (error) {
			console.error(error)
		}
	}

	play() {
		this.player.unpause()
	}

	pause() {
		this.player.pause()
	}
}

module.exports = {
	MusicManager: MusicManager
}