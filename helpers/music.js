const { Client, Interaction, MessageEmbed, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { AudioPlayer, VoiceConnection } = require('@discordjs/voice')
const ytdl = require("ytdl-core")
const prism = require('prism-media')
const { pipeline } = require('stream')

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

	/**
	 * @param {() => {}} noop - noop
	 */
	noop = () => { }

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
	 * Returns whether the format matches the predefined filter.
	 *
	 * @private
	 *
	 * @param {Format} format - format
	 */
	filter(format) {
		return format.codecs === 'opus' &&
			format.container === 'webm' &&
			format.audioSampleRate == 48000
	}

	/**
	 * Tries to find the highest bitrate audio-only format. Failing that, will use any available audio format.
	 *
	 * @private
	 *
	 * @param {Object[]} formats The formats to select from
	 * @param {boolean} isLive Whether the content is live or not
	 */
	nextBestFormat(formats, isLive) {
		let filter = format => format.audioBitrate
		if (isLive) filter = format => format.audioBitrate && format.isHLS
		formats = formats
			.filter(filter)
			.sort((a, b) => b.audioBitrate - a.audioBitrate)
		return formats.find(format => !format.bitrate) || formats[0]
	}

	/**
	 * Download the audio of the given url.
	 *
	 * @param {string} url - url
	 * @param {Object[]} options - options
	 */
	async download(url, options = {}) {
		const info = await ytdl.getInfo(url)
		// Prefer opus
		const filter = this.filter
		const noop = this.noop
		const format = info.formats.find(filter)
		const canDemux = format && info.videoDetails.lengthSeconds != 0

		if (canDemux) {
			options = { ...options, filter }
		} else if (info.videoDetails.lengthSeconds != 0) {
			options = { ...options, filter: 'audioonly' }
		}

		if (canDemux) {
			const demuxer = new prism.opus.WebmDemuxer()

			return pipeline([
				ytdl.downloadFromInfo(info, options),
				demuxer,
			], noop)
		} else {
			const bestFormat = this.nextBestFormat(info.formats, info.videoDetails.isLiveContent)

			if (!bestFormat) {
				throw new Error('No suitable format found')
			}

			const transcoder = new prism.FFmpeg({
				args: [
					'-reconnect', '1',
					'-reconnect_streamed', '1',
					'-reconnect_delay_max', '5',
					'-i', bestFormat.url,
					'-analyzeduration', '0',
					'-loglevel', '0',
					'-f', 's16le',
					'-ar', '48000',
					'-ac', '2',
				],
				shell: false,
			})

			const opus = new prism.opus.Encoder({
				rate: 48000,
				channels: 2,
				frameSize: 960
			})
			return pipeline([transcoder, opus], noop)
		}
	}

	/**
	 * Returns whether the current playback queue is empty.
	 *
	 * @private
	 *
	 * @param {Queue} queue - The current player queue.
	 * @param {Interaction} interaction - The interaction responsible for the action
	 */
	playBackQueueIsEmpty(queue, interaction) {
		if (!queue || !queue.playing) {
			interaction.reply({
				content: '❌ Playback queue is empty',
				ephemeral: true 
			}).catch(e => console.error(e))

			return true
		}
		return false
	}

	/**
	 * Creates Activity Invite in the voice channel
	 *
	 * @param {VoiceChannel} voiceChannel - voice channel
	 * @param {Interaction} interaction - interaction
	 * @param {string} videoLink - video link
	 */
	async queue(voiceChannel, interaction, videoLink) {
		const queue = this.client.player.createQueue(interaction.guild, {
			metadata: {
				channel: interaction.channel
			}
		})

		// verify vc connection
		try {
			if (!queue.connection) {
				await queue.connect(voiceChannel)
			}
		} catch {
			queue.destroy()
			return interaction.reply({
				content: "Could not join the voice channel.",
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const track = await this.client.player.search(videoLink, {
			requestedBy: interaction.user
		})
			.then(x => x.tracks[0])
			.catch(e => console.error(e))

		if (!track) {
			return interaction.reply({
				content: `❌ | Track **${videoLink}** not found!`,
				ephemeral: true
			}).catch(e => console.error(e))
		}

		await interaction.reply({
			content: `⏱️ | Loading **${track.title}** track!`,
			ephemeral: true
		}).catch(e => console.error(e))

		return queue.play(track)
	}

	/**
	 * Resumes the playback.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	play(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.setPaused(false)

		return interaction.reply({
			content: success ? `▶️ **${queue.current.title}** is playing.` : '❌ Something went wrong.'
		}).catch(e => console.error(e))
	}

	/**
	 * Pauses the playback.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	pause(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.setPaused(true)

		return interaction.reply({
			content: success ? `⏸ **${queue.current.title}** has stopped.` : '❌ Something went wrong.'
		}).catch(e => console.error(e))
	}

	/**
	 * Skips the playback forwards.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	forwards(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.skip()

		return interaction.reply({
			content: success ? `⏭ **${queue.current.title}** skipped.` : '❌ Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Skips the playback backwards.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	backwards(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.previousTracks[1]) {
			return interaction.reply({
				content: '❌ A previous music doesn’t exist.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const success = queue.back()

		return interaction.reply({
			content: success ? '⏮ Previous music started playing...' : '❌ Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Clears the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	clear(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.tracks[0]) {
			return interaction.reply({
				content: '❌ The queue is already empty.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const success = queue.clear()

		return interaction.reply({
			content: success ? '🗑️ The queue has been cleared.' : '❌ Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Stops the player and removes all playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	stop(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id);

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

        const success = queue.destroy();

        return interaction.reply({ 
			content: success ? 'Playback has been turned off.' : '❌ Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Lists the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	list(interaction) {
		const queue = this.client.player.getQueue(interaction.guild.id)

        if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.tracks[0]) {
			return interaction.reply({
				content: `❌ Queue is empty.`,
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const embed = new MessageEmbed()
		embed.setColor('#FF9300')
		embed.setThumbnail(interaction.guild.iconURL({
			size: 2048,
			dynamic: true
		}))
		embed.setTitle(`Music List - ${interaction.guild.name}`)

		const tracks = queue.tracks.map((track, i) => `**${i + 1}** - ${track.title} | ${track.author} (Started by <@${track.requestedBy.id}>)`)

		const songs = queue.tracks.length
		const nextSongs = songs > 5 ? `...and **${songs - 5}** other songs.` : `There are **${songs}** songs in the list.`

		embed.setDescription(`Currently Playing: \`${queue.current.title}\`\n\n${tracks.slice(0, 5).join('\n')}\n\n${nextSongs}`)
		embed.setTimestamp()

		return interaction.reply({
			embeds: [embed]
		}).catch(e => console.error(e))
	}
}

module.exports = {
	MusicManager: MusicManager
}