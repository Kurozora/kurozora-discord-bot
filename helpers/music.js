const axios = require('axios')
const qs = require('qs')
const { Client, Interaction, EmbedBuilder, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { VoiceConnection } = require('@discordjs/voice')
const { Player, QueryType, QueueRepeatMode } = require('discord-player')
const prism = require('@arno500/prism-media')
const { pipeline } = require('stream')
const MusicKit = require('node-musickit-api/promises')
const musicKit = new MusicKit({
	key: process.env['AM_DEVELOPER_TOKEN'],
	teamId: process.env['AM_TEAM_ID'],
	keyId: process.env['AM_KEY_ID'],
})
const spotifyClientID = process.env['SPOTIFY_CLIENT_ID']
const spotifyClientSecret = process.env['SPOTIFY_CLIENT_SECRET']

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
	 * @param {Player} player - player
	 */
	player

	/**
	 * @param {() => {}} noop - noop
	 */
	noop = () => { }

	/**
	 * @param {} indexEmojis = index emojis
	 */
	indexEmojis = [
		'0️⃣',
		'1️⃣',
		'2️⃣',
		'3️⃣',
		'4️⃣',
		'5️⃣',
		'6️⃣',
		'7️⃣',
		'8️⃣',
		'9️⃣',
		'🔟',
	]

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - Client
	 * @param {REST} rest - REST
	 * @param {Player} player - Player
	 */
	constructor(client, rest, player) {
		this.client = client
		this.player = player
		this.rest = rest
	}

	// MARK: - Functions
	/**
	 * Requests and returns a Spotify access token
	 */
	async getSpotifyAccessToken() {
		const authToken = Buffer.from(`${spotifyClientID}:${spotifyClientSecret}`, 'utf-8').toString('base64')
		const data = qs.stringify({ 'grant_type': 'client_credentials' })
		const response = await axios.post('https://accounts.spotify.com/api/token', data, {
			headers: {
				'Authorization': `Basic ${authToken}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			}
		})
			.then(response => response.data)
			.catch(error => console.error(error))

		return response.access_token
	}

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
		if (!queue || !queue.node.isPlaying()) {
			interaction.reply({
				content: '❌ | Playback queue is empty',
				ephemeral: true
			}).catch(e => console.error(e))

			return true
		}
		return false
	}

	/**
	 * Search for a song on Apple Music.
	 *
	 * @param {string} searchQuery - search query
	 */
	async searchMusicKit(searchQuery) {
		let response = await musicKit.search('us', 'songs', searchQuery, 1)
			.then(response => response.results)
			.catch(error => console.error(error))

		if (response?.songs !== undefined) {
			return response.songs.data[0]
		}

		return null
	}

	/**
	 * Search for a song on Spotify.
	 *
	 * @param {string} searchQuery - search query
	 */
	async searchSpotify(searchQuery) {
		const spotifyAccessToken = await this.getSpotifyAccessToken()

		if (!spotifyAccessToken) {
			return
		}

		const searchAPIURL = `https://api.spotify.com/v1/search`
		const response = await axios.get(searchAPIURL, {
			headers: {
				'Authorization': `Bearer ${spotifyAccessToken}`
			},
			params: {
				'q': searchQuery,
				'type': 'track'
			}
		})
			.then(response => response.data)
			.catch(error => console.error(error))

		return response.tracks
	}

	/**
	 * Search for a video with the given search query.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} searchQuery - search query
	 *
	 * @returns {Track} track - track
	 */
	async search(interaction, searchQuery) {
		const tracks = await this.player.search(searchQuery, {
			requestedBy: interaction.user,
			searchEngine: QueryType.YOUTUBE
		})
			.then(x => x.tracks)
			.catch(e => console.error(e))

		if (!tracks || !tracks.length) {
			return interaction.reply({
				content: `❌ | Track **${searchQuery}** not found!`,
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const maxTracks = tracks.slice(0, 5)
		const embed = new EmbedBuilder()

		embed.setColor(0xFF9300)
		embed.setAuthor({
			name: `${interaction.user.username}`,
			iconURL: interaction.user.displayAvatarURL({
				size: 1024,
				dynamic: true
			})
		})
		embed.setDescription(`${maxTracks.map((track, i) => `**${this.indexEmojis[i + 1]}** \`${track.duration}\` ${track.title} | **${track.author}**`).join('\n')}\n\nReply with **1** to **${maxTracks.length}** or **cancel** ⬇️`)
		embed.setTimestamp()

		await interaction.reply({
			content: `Search results for \`${searchQuery}\``,
			embeds: [embed]
		})

		const collector = interaction.channel.createMessageCollector({
			time: 30000,
			errors: ['time'],
			filter: message => message.author.id === interaction.user.id
		})

		collector.on('collect', async (query) => {
			query.delete()

			if (query.content.toLowerCase() === 'cancel') {
				collector.stop()
				return interaction.deleteReply()
			}

			const value = parseInt(query.content)

			if (!value || value <= 0 || value > maxTracks.length) {
				return collector.channel.send({
					content: `❌ | Invalid response, try a value between **1** and **${maxTracks.length}** or **cancel**`,
					ephemeral: true
				})
			}

			collector.stop()
			interaction.deleteReply()

			const selectedTrack = tracks[value - 1]
			const musicKitTrack = await this.searchMusicKit(searchQuery)
			const spotifyTracks = await this.searchSpotify(searchQuery)
			var content = `🔎 | \`${searchQuery}\` by <@${interaction.user.id}>`
			var musicKitURL
			var spotifyTrack
			var spotifyURL

			// Add YouTube link
			content += `\n📺 | ${selectedTrack.url}`

			// Add Apple Music Link
			if (musicKitTrack) {
				musicKitURL = musicKitTrack.attributes.url

				if (musicKitURL) {
					content += `\n🍎 | ${musicKitURL.replace('\\', '')}`
				}
			}

			// Add Spotify link
			if (spotifyTracks.items.length) {
				spotifyTrack = spotifyTracks.items[0]
			}

			if (spotifyTrack) {
				spotifyURL = spotifyTrack.external_urls.spotify

				if (spotifyURL) {
					content += `\n🟢 | ${spotifyURL.replace('\\', '')}`
				}
			}

			// Send results
			return collector.channel.send({
				content: content,
			}).catch(e => console.error(e))
		})

		collector.on('end', (message, reason) => {
			if (reason === 'time') {
				return collector.channel.send({
					content: `❌ | Search timed out...`,
					ephemeral: true,
					allowedMentions: {
						parse: [],
						repliedUser: false
					}
				})
			}
		})

		return
	}

	/**
	 * Creates Activity Invite in the voice channel
	 *
	 * @param {VoiceChannel} voiceChannel - voice channel
	 * @param {Interaction} interaction - interaction
	 * @param {string} searchQuery - video link
	 */
	async queue(voiceChannel, interaction, searchQuery) {
		const queue = this.player.nodes.create(interaction.guild, {
			metadata: {
				channel: interaction.channel,
				client: interaction.guild.members.me,
				requestedBy: interaction.user,
			}
		})

		// verify vc connection
		try {
			if (!queue.connection) {
				await queue.connect(voiceChannel)
			}
		} catch {
			queue.delete()
			return interaction.reply({
				content: '❌ | Could not join the voice channel.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const track = await this.player.search(searchQuery, {
			requestedBy: interaction.user,
			searchEngine: QueryType.YOUTUBE
		})
			.then(x => x.tracks[0])
			.catch(e => console.error(e))

		if (!track) {
			return interaction.reply({
				content: `❌ | Track **${searchQuery}** not found!`,
				ephemeral: true
			}).catch(e => console.error(e))
		}

		await interaction.reply({
			content: `⏱️ | Loading **${track.title}** track!`,
			ephemeral: true
		}).catch(e => console.error(e))

		return queue.node.play(track)
	}

	/**
	 * Resumes the playback.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	play(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.node.resume()

		return interaction.reply({
			content: success ? `▶️ | **${queue.currentTrack.title}** is playing.` : '❌ | Something went wrong.'
		}).catch(e => console.error(e))
	}

	/**
	 * Pauses the playback.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	pause(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.node.pause()

		return interaction.reply({
			content: success ? `⏸ | **${queue.currentTrack.title}** has stopped.` : '❌ | Something went wrong.'
		}).catch(e => console.error(e))
	}

	/**
	 * Skips the playback forwards.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	forwards(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		const success = queue.node.skip()

		return interaction.reply({
			content: success ? `⏭ | **${queue.currentTrack.title}** skipped.` : '❌ | Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Skips the playback backwards.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	backwards(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.history.previousTrack) {
			return interaction.reply({
				content: '❌ | A previous music doesn’t exist.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const success = queue.history.back()

		return interaction.reply({
			content: success ? '⏮ | Previous music started playing...' : '❌ | Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Shuffles the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	shuffle(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.tracks.toArray()[0]) {
			return interaction.reply({
				content: '❌ | There are no other songs to play.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const success = queue.tracks.shuffle()

		return interaction.reply({
			content: success ? `🔀 | Queue shuffled **${queue.tracks.size}** song(s)!` : '❌ | Something went wrong'
		}).catch(e => console.error(e))
	}

	/**
	 * Loops the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	loop(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)
		const loopMode = interaction.options.getString('mode') ?? interaction.options.getString('info')

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (loopMode === undefined || loopMode === null) {
			if (queue.repeatMode === QueueRepeatMode.OFF) {
				queue.setRepeatMode(QueueRepeatMode.QUEUE)
				return interaction.reply({
					embeds: [{
						description: `🔁 | Looping the **queue**.`,
						color: 0xFF9300
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.QUEUE) {
				queue.setRepeatMode(QueueRepeatMode.TRACK)
				return interaction.reply({
					embeds: [{
						description: `🔂 | Looping the **current track**.`,
						color: 0xFF9300
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.TRACK) {
				queue.setRepeatMode(QueueRepeatMode.AUTOPLAY)
				return interaction.reply({
					embeds: [{
						description: `✅ | Autoplay is **enabled**.`,
						color: 0xFF9300
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.AUTOPLAY) {
				queue.setRepeatMode(QueueRepeatMode.OFF)
				return interaction.reply({
					embeds: [{
						description: `✅ | Loop is **disabled**.`,
						color: 0xFF9300
					}]
				})
			}
		}

		if (loopMode.includes('off')) {
			queue.setRepeatMode(QueueRepeatMode.OFF)
			interaction.reply({
				embeds: [{
					description: `✅ | Loop is now disabled.`,
					color: 0xFF9300
				}]
			})
		} else if (loopMode.includes('track')) {
			queue.setRepeatMode(QueueRepeatMode.TRACK)
			return interaction.reply({
				embeds: [{
					description: `🔂 | Looping the current track.`,
					color: 0xFF9300
				}]
			})
		} else if (loopMode.includes('queue')) {
			queue.setRepeatMode(QueueRepeatMode.QUEUE)
			return interaction.reply({
				embeds: [{
					description: `🔁 | Looping the queue.`,
					color: 0xFF9300
				}]
			})
		} else if (loopMode.includes('autoplay')) {
			queue.setRepeatMode(QueueRepeatMode.AUTOPLAY)
			return interaction.reply({
				embeds: [{
					description: `▶️ | Autoplay has been enabled.`,
					color: 0xFF9300
				}]
			})
		} else if (loopMode.includes('status')) {
			const embed = new EmbedBuilder()
			embed.setColor(0xFF9300)

			let mode
			if (queue.repeatMode === QueueRepeatMode.OFF) {
				mode = '`Off`'
			} else if (queue.repeatMode === QueueRepeatMode.TRACK) {
				mode = '`Track`'
			} else if (queue.repeatMode === QueueRepeatMode.QUEUE) {
				mode = '`Queue`'
			} else if (queue.repeatMode === QueueRepeatMode.AUTOPLAY) {
				mode = '`Autoplay`'
			}

			embed.setDescription(`Current loop mode: ${mode}\nOptions: Autoplay, Track, Queue, or Off`)

			return interaction.reply({
				embeds: [embed]
			})
		}
	}

	/**
	 * Clears the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	async clear(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.tracks.toArray()[0]) {
			return interaction.reply({
				content: '❌ | The queue is already empty.',
				ephemeral: true
			}).catch(e => console.error(e))
		}

		await queue.tracks.clear()

		return interaction.reply({
			content: '🗑️ | The queue has been cleared.'
		}).catch(e => console.error(e))
	}

	/**
	 * Stops the player and removes all playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	async stop(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		await queue.delete()

		return interaction.reply({
			content: '⏹ | Playback has been turned off.'
		}).catch(e => console.error(e))
	}

	/**
	 * Adjust the playback volume.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	volume(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)
		const maxVolume = 100

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		// Return the current volume level, instructions for adjusting the volume if no volume level is given
		const volumeLevel = interaction.options.getInteger('level')
		if (!volumeLevel) {
			const embed = new EmbedBuilder()
			embed.setColor(0xFF9300)
			embed.setDescription(`The volume is set on 🔊 ${queue.node.volume} \n*↳ Please enter between **1** and **${maxVolume}** to change the volume.*`)
			return interaction.reply({
				embeds: [embed],
				ephemeral: true
			})
		}

		// Check if the volume has already been set to the requested level
		if (queue.node.volume === volumeLevel) {
			const embed = new EmbedBuilder()
			embed.setColor(0xFF9300)
			embed.setDescription(`The volume you want to change is the same as the current one. \n*↳ Please try again with a different number.*`)
			return interaction.reply({
				embeds: [embed]
			})
		}

		// Check if the requested level is valid
		if (volumeLevel < 0 || volumeLevel > maxVolume) {
			const embed = new EmbedBuilder()
			embed.setColor(0xFF9300)
			embed.setDescription(`The specified number is not valid. \n*↳ Please enter between **1** and **${maxVolume}** to change the volume.*`)
			return interaction.reply({
				embeds: [embed]
			})
		}

		const success = queue.node.setVolume(volumeLevel)

		return interaction.reply({
			embeds: [{
				description: success ? `✅ Volume set to ${volumeLevel}` : '❌ | Something went wrong',
				color: 0xFF9300
			}]
		})
	}

	/**
	 * Lists the playback queue.
	 *
	 * @param {Interaction} interaction - interaction
	 */
	list(interaction) {
		const queue = this.player.nodes.get(interaction.guild.id)

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		if (!queue.tracks.toArray()[0]) {
			return interaction.reply({
				content: `❌ | Queue is empty.`,
				ephemeral: true
			}).catch(e => console.error(e))
		}

		const embed = new EmbedBuilder()
		embed.setColor(0xFF9300)
		embed.setThumbnail(interaction.guild.iconURL({
			size: 2048,
			dynamic: true
		}))
		embed.setTitle('Playback Queue')

		const tracks = queue.tracks.map((track, i) => `**${i + 1}** - ${track.title} | ${track.author} (Started by <@${track.requestedBy.id}>)`)

		const songs = queue.tracks.size
		const nextSongs = songs > 5 ? `...and **${songs - 5}** other songs.` : `There are **${songs}** songs in the list.`

		embed.setDescription(`Currently Playing: \`${queue.currentTrack.title}\`\n\n${tracks.slice(0, 5).join('\n')}\n\n${nextSongs}`)
		embed.setTimestamp()

		return interaction.reply({
			embeds: [embed]
		}).catch(e => console.error(e))
	}
}

module.exports = {
	MusicManager: MusicManager
}
