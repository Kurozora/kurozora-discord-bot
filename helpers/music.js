const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Interaction, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, VoiceChannel } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Player, QueueRepeatMode } = require('discord-player')
const { DefaultExtractors } = require('@discord-player/extractor')
const { YoutubeiExtractor } = require('discord-player-youtubei')
const catalog = require('./music_catalog')
const youtubeDL = require('youtube-dl-exec')
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The prefix on every music component’s custom id. */
const componentPrefix = 'music_'

/** The extractor every YouTube lookup is routed through. */
const youtubeSearchEngine = `ext:${YoutubeiExtractor.identifier}`

/** The flags every yt-dlp download runs with. */
const youtubeDLFlags = {
	jsRuntimes: 'node',
	remoteComponents: 'ejs:github',
	extractorArgs: 'youtube:player_client=web_embedded',
	output: '-',
	noWarnings: true,
	noProgress: true
}

/** The log prefix youtubei.js puts on its search-result parser warnings. */
const noisyLogPrefix = '[YOUTUBEJS][Text]:'

/** The number of choices Discord accepts per autocomplete response. */
const maxAutocompleteChoices = 25

/** The number of characters Discord accepts in a choice. */
const maxChoiceLength = 100

/** The number of buttons Discord accepts per action row. */
const maxButtonsPerRow = 5

/** The number of alternatives offered when changing a link. */
const maxVideoChoices = 5

/** The number of sibling releases searched for more Spotify links. */
const maxSiblingLookups = 3

/** The name each changeable link goes by. */
const serviceNames = {
	video: 'video',
	apple: 'Apple Music link',
	spotify: 'Spotify link'
}

/** The prefix marking a target that is a query rather than a track id. */
const queryPrefix = 'q:'

/** The highest volume the playback accepts. */
const maxVolume = 100

/** The number of tracks listed from the playback queue. */
const listedTracks = 5

/**
 * The audio stream of the given track.
 *
 * @param {Object} track - track
 *
 * @returns {Promise<?Object>} stream - stream
 */
async function youtubeStream(track) {
	const videoID = catalog.youtubeIDIn(track.url ?? '')
	const download = youtubeDL.exec(videoID ? `https://youtu.be/${videoID}` : track.url, {
		...youtubeDLFlags,
		format: track.live ? 'best[height<=360]' : 'bestaudio'
	})

	download.catch(error => {
		if (error.killed) {
			return
		}

		const reported = (error.stderr ?? '')
			.split('\n')
			.find(line => line.startsWith('ERROR:'))

		console.error(`[YouTube] Couldn’t stream “${track.title}”: ${reported ?? error.shortMessage ?? error.message}`)
	})

	const stream = download.stdout

	if (!stream) {
		return null
	}

	stream.once('close', () => download.kill('SIGKILL'))

	return stream
}

/** Whether the parser noise has been silenced. */
let noiseSilenced = false

/**
 * Drops the youtubei.js warnings that report unparsed search-result text.
 *
 * @returns {void}
 */
function silenceParserNoise() {
	if (noiseSilenced) {
		return
	}

	const warn = console.warn.bind(console)

	console.warn = (...args) => {
		if (args[0] !== noisyLogPrefix) {
			warn(...args)
		}
	}

	noiseSilenced = true
}

/**
 * The given duration, in minutes and seconds.
 *
 * @param {number} duration - duration
 *
 * @returns {string} duration - duration
 */
function formatted(duration) {
	const seconds = Math.round((duration ?? 0) / 1000)
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The given text, cut to the given length.
 *
 * @param {string} text - text
 * @param {number} length - length
 *
 * @returns {string} text - text
 */
function truncated(text, length) {
	return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/**
 * A link button opening the given url.
 *
 * @param {string} label - label
 * @param {string} emoji - emoji
 * @param {string} url - url
 *
 * @returns {ButtonBuilder} button - button
 */
function linkButton(label, emoji, url) {
	return new ButtonBuilder()
		.setLabel(label)
		.setEmoji(emoji)
		.setURL(url)
		.setStyle(ButtonStyle.Link)
}

/**
 * A button opening the alternatives for the given service.
 *
 * @param {string} service - service
 * @param {string} label - label
 * @param {string} emoji - emoji
 * @param {Object} track - track
 * @param {Object} user - user
 *
 * @returns {ButtonBuilder} button - button
 */
function changeButton(service, label, emoji, track, user) {
	return new ButtonBuilder()
		.setCustomId(`${componentPrefix}${service}_${track.id}_${user.id}`)
		.setLabel(label)
		.setEmoji(emoji)
		.setStyle(ButtonStyle.Secondary)
}

/**
 * The given buttons, in rows.
 *
 * @param {ButtonBuilder[]} buttons - buttons
 *
 * @returns {ActionRowBuilder[]} rows - rows
 */
function rowsOf(buttons) {
	const rows = []

	for (let offset = 0; offset < buttons.length; offset += maxButtonsPerRow) {
		rows.push(new ActionRowBuilder().addComponents(buttons.slice(offset, offset + maxButtonsPerRow)))
	}

	return rows
}

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
	 * @param {Player} player - player
	 */
	player

	/**
	 * @param {Promise<void>} ready - ready
	 */
	ready

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

		silenceParserNoise()

		this.ready = (async () => {
			await this.player.extractors.loadMulti(DefaultExtractors)
			await this.player.extractors.register(YoutubeiExtractor, {
				useYoutubeDL: true,
				createStream: track => youtubeStream(track)
			})
		})().catch(error => console.error(error))
	}

	// MARK: - Functions
	/**
	 * Responds to the interaction with the tracks matching its focused value.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async autocomplete(interaction) {
		const term = interaction.options.getFocused().trim()

		if (!term.length) {
			return interaction.respond([]).catch(error => console.error(error))
		}

		const tracks = await catalog.searchTracks(term, maxAutocompleteChoices)
		const choices = tracks
			.slice(0, maxAutocompleteChoices - 1)
			.map(track => ({
				name: truncated(`${track.title} — ${track.artist} · ${formatted(track.durationMS)}`, maxChoiceLength),
				value: track.id
			}))

		choices.push({
			name: truncated(`Search “${term}”`, maxChoiceLength),
			value: truncated(`${queryPrefix}${term}`, maxChoiceLength)
		})

		return interaction.respond(choices).catch(error => console.error(error))
	}

	/**
	 * Replies with the given track and where to play it.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} target - target
	 *
	 * @returns {Promise<*>}
	 */
	async search(interaction, target) {
		await interaction.deferReply()

		const track = await this.#trackFor(target)

		if (!track) {
			return interaction.editReply({
				content: `❌ | Nothing found for \`${target}\`.`
			}).catch(error => console.error(error))
		}

		const links = await catalog.linksFor(track)
		const videoID = await this.#videoIDFor(track, links)
		const selection = {
			video: videoID ? catalog.youtubeURLFor(videoID) : null,
			apple: links.appleMusic,
			spotify: links.spotify
		}

		return interaction.editReply(this.#resultPayload(interaction.user, track, links, selection))
			.catch(error => console.error(error))
	}

	/**
	 * Queues the given track for playback.
	 *
	 * @param {VoiceChannel} voiceChannel - voice channel
	 * @param {Interaction} interaction - interaction
	 * @param {string} target - target
	 *
	 * @returns {Promise<*>}
	 */
	async queue(voiceChannel, interaction, target) {
		await interaction.deferReply()

		const query = await this.#playbackQueryFor(target)
		const track = await this.#play(voiceChannel, interaction, query)

		if (!track) {
			return interaction.editReply({
				content: `❌ | Track **${target}** couldn’t be played.`
			}).catch(error => console.error(error))
		}

		return interaction.editReply({
			content: `⏱️ | Loading **${track.title}**!`
		}).catch(error => console.error(error))
	}

	/**
	 * Handles the given music button or select menu.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handleComponent(interaction) {
		const action = interaction.customId.slice(componentPrefix.length)

		if (action.startsWith('queue_')) {
			return this.#queueVideo(interaction, action.slice('queue_'.length))
		}

		for (const service of Object.keys(serviceNames)) {
			if (action.startsWith(`${service}_`)) {
				return this.#offerAlternatives(interaction, service, action.slice(`${service}_`.length))
			}

			if (action.startsWith(`set${service}_`)) {
				return this.#applyAlternative(interaction, service, action.slice(`set${service}_`.length))
			}
		}

		return interaction.deferUpdate().catch(error => console.error(error))
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
				flags: MessageFlags.Ephemeral
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
				flags: MessageFlags.Ephemeral
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
						color: appColor
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.QUEUE) {
				queue.setRepeatMode(QueueRepeatMode.TRACK)
				return interaction.reply({
					embeds: [{
						description: `🔂 | Looping the **current track**.`,
						color: appColor
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.TRACK) {
				queue.setRepeatMode(QueueRepeatMode.AUTOPLAY)
				return interaction.reply({
					embeds: [{
						description: `✅ | Autoplay is **enabled**.`,
						color: appColor
					}]
				})
			} else if (queue.repeatMode === QueueRepeatMode.AUTOPLAY) {
				queue.setRepeatMode(QueueRepeatMode.OFF)
				return interaction.reply({
					embeds: [{
						description: `✅ | Loop is **disabled**.`,
						color: appColor
					}]
				})
			}
		}

		if (loopMode.includes('off')) {
			queue.setRepeatMode(QueueRepeatMode.OFF)
			interaction.reply({
				embeds: [{
					description: `✅ | Loop is now disabled.`,
					color: appColor
				}]
			})
		} else if (loopMode.includes('track')) {
			queue.setRepeatMode(QueueRepeatMode.TRACK)
			return interaction.reply({
				embeds: [{
					description: `🔂 | Looping the current track.`,
					color: appColor
				}]
			})
		} else if (loopMode.includes('queue')) {
			queue.setRepeatMode(QueueRepeatMode.QUEUE)
			return interaction.reply({
				embeds: [{
					description: `🔁 | Looping the queue.`,
					color: appColor
				}]
			})
		} else if (loopMode.includes('autoplay')) {
			queue.setRepeatMode(QueueRepeatMode.AUTOPLAY)
			return interaction.reply({
				embeds: [{
					description: `▶️ | Autoplay has been enabled.`,
					color: appColor
				}]
			})
		} else if (loopMode.includes('status')) {
			const embed = new EmbedBuilder()
			embed.setColor(appColor)

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
				flags: MessageFlags.Ephemeral
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

		if (this.playBackQueueIsEmpty(queue, interaction)) {
			return
		}

		// Return the current volume level, instructions for adjusting the volume if no volume level is given
		const volumeLevel = interaction.options.getInteger('level')
		if (!volumeLevel) {
			const embed = new EmbedBuilder()
			embed.setColor(appColor)
			embed.setDescription(`The volume is set on 🔊 ${queue.node.volume} \n*↳ Please enter between **1** and **${maxVolume}** to change the volume.*`)
			return interaction.reply({
				embeds: [embed],
				flags: MessageFlags.Ephemeral
			})
		}

		// Check if the volume has already been set to the requested level
		if (queue.node.volume === volumeLevel) {
			const embed = new EmbedBuilder()
			embed.setColor(appColor)
			embed.setDescription(`The volume you want to change is the same as the current one. \n*↳ Please try again with a different number.*`)
			return interaction.reply({
				embeds: [embed]
			})
		}

		// Check if the requested level is valid
		if (volumeLevel < 0 || volumeLevel > maxVolume) {
			const embed = new EmbedBuilder()
			embed.setColor(appColor)
			embed.setDescription(`The specified number is not valid. \n*↳ Please enter between **1** and **${maxVolume}** to change the volume.*`)
			return interaction.reply({
				embeds: [embed]
			})
		}

		const success = queue.node.setVolume(volumeLevel)

		return interaction.reply({
			embeds: [{
				description: success ? `✅ Volume set to ${volumeLevel}` : '❌ | Something went wrong',
				color: appColor
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
				flags: MessageFlags.Ephemeral
			}).catch(e => console.error(e))
		}

		const embed = new EmbedBuilder()
		embed.setColor(appColor)
		embed.setThumbnail(interaction.guild.iconURL({
			size: 2048,
			dynamic: true
		}))
		embed.setTitle('Playback Queue')

		const tracks = queue.tracks.map((track, i) => `**${i + 1}** - ${track.title} | ${track.author} (Started by <@${track.requestedBy.id}>)`)

		const songs = queue.tracks.size
		const nextSongs = songs > listedTracks ? `...and **${songs - listedTracks}** other songs.` : `There are **${songs}** songs in the list.`

		embed.setDescription(`Currently Playing: \`${queue.currentTrack.title}\`\n\n${tracks.slice(0, listedTracks).join('\n')}\n\n${nextSongs}`)
		embed.setTimestamp()

		return interaction.reply({
			embeds: [embed]
		}).catch(e => console.error(e))
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
				flags: MessageFlags.Ephemeral
			}).catch(e => console.error(e))

			return true
		}
		return false
	}

	/**
	 * The track the given target names.
	 *
	 * @param {string} target - target
	 *
	 * @returns {Promise<?Object>} track - track
	 */
	async #trackFor(target) {
		const value = target.trim()

		if (/^\d+$/.test(value)) {
			return catalog.trackByID(value)
		}

		const term = value.startsWith(queryPrefix) ? value.slice(queryPrefix.length) : value
		const [first] = await catalog.searchTracks(term, 1)

		return first ? catalog.trackByID(first.id) : null
	}

	/**
	 * The YouTube video id for the given track.
	 *
	 * @param {Object} track - track
	 * @param {Object} links - links
	 *
	 * @returns {Promise<?string>} id - id
	 */
	async #videoIDFor(track, links) {
		const [curated] = links.youtube

		if (curated) {
			return curated
		}

		const videos = await this.#videosFor(track)
		const matched = videos.find(video =>
			catalog.sameDuration(video.durationMS, track.durationMS) &&
			(catalog.sameArtist(video.author, track.artist) ||
				catalog.comparable(video.title).includes(catalog.comparable(track.artist))))

		return (matched ?? videos[0])?.id ?? null
	}

	/**
	 * The YouTube videos matching the given track.
	 *
	 * @param {Object} track - track
	 *
	 * @returns {Promise<Object[]>} videos - videos
	 */
	async #videosFor(track) {
		const videos = await this.#searchYouTube(`${track.artist} ${track.title}`.trim())

		return videos
			.slice(0, maxVideoChoices)
			.map(video => ({
				id: catalog.youtubeIDIn(video.url ?? ''),
				title: video.title ?? '',
				author: video.author ?? '',
				durationMS: video.durationMS ?? 0
			}))
			.filter(video => video.id)
	}

	/**
	 * The tracks matching the given query.
	 *
	 * @param {string} query - query
	 * @param {?Object} requestedBy - requested by
	 *
	 * @returns {Promise<Object[]>} tracks - tracks
	 */
	async #searchYouTube(query, requestedBy = null) {
		await this.ready

		const options = /^https?:\/\//.test(query) ? {} : { searchEngine: youtubeSearchEngine }

		return this.player.search(query, { ...options, requestedBy: requestedBy })
			.then(result => result.tracks)
			.catch(error => {
				console.error(`[YouTube] Couldn’t search “${query}”: ${error.message}`)
				return []
			})
	}

	/**
	 * The playback query the given target resolves to.
	 *
	 * @param {string} target - target
	 *
	 * @returns {Promise<string>} query - query
	 */
	async #playbackQueryFor(target) {
		const value = target.trim()

		if (/^https?:\/\//.test(value)) {
			return value
		}

		const track = await this.#trackFor(value)

		if (!track) {
			return value.startsWith(queryPrefix) ? value.slice(queryPrefix.length) : value
		}

		const links = await catalog.linksFor(track)
		const videoID = await this.#videoIDFor(track, links)

		return videoID ? catalog.youtubeURLFor(videoID) : `${track.artist} ${track.title}`.trim()
	}

	/**
	 * Plays the given query in the given voice channel.
	 *
	 * @param {VoiceChannel} voiceChannel - voice channel
	 * @param {Interaction} interaction - interaction
	 * @param {string} query - query
	 *
	 * @returns {Promise<?Object>} track - track
	 */
	async #play(voiceChannel, interaction, query) {
		const queue = this.player.nodes.create(interaction.guild, {
			metadata: {
				channel: interaction.channel,
				client: interaction.guild.members.me,
				requestedBy: interaction.user
			}
		})

		try {
			if (!queue.connection) {
				await queue.connect(voiceChannel)
			}
		} catch {
			queue.delete()
			return null
		}

		const [track] = await this.#searchYouTube(query, interaction.user)

		if (!track) {
			return null
		}

		await queue.node.play(track)

		return track
	}

	/**
	 * Queues the given video for playback.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} videoID - video id
	 *
	 * @returns {Promise<*>}
	 */
	async #queueVideo(interaction, videoID) {
		const voiceChannel = interaction.member?.voice?.channel

		if (!voiceChannel) {
			return interaction.reply({
				content: '❌ | Connect to a voice channel first.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		const track = await this.#play(voiceChannel, interaction, catalog.youtubeURLFor(videoID))

		return interaction.editReply({
			content: track ? `⏱️ | Loading **${track.title}**!` : '❌ | That video couldn’t be played.'
		}).catch(error => console.error(error))
	}

	/**
	 * Offers the alternatives the given link can be changed to.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} service - service
	 * @param {string} target - target
	 *
	 * @returns {Promise<*>}
	 */
	async #offerAlternatives(interaction, service, target) {
		const [trackID, requesterID] = target.split('_')

		if (interaction.user.id !== requesterID) {
			return interaction.reply({
				content: `❌ | Only the person who searched can change the ${serviceNames[service]}.`,
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		const track = await catalog.trackByID(trackID)
		const shown = this.#selectionFrom(interaction.message)[service]
		const current = service === 'video' && shown ? catalog.youtubeIDIn(shown) : shown
		const choices = (track ? await this.#alternativesFor(service, track) : [])
			.filter(choice => choice.value !== current)

		if (!choices.length) {
			return interaction.editReply({
				content: `❌ | No other ${serviceNames[service]} was found.`
			}).catch(error => console.error(error))
		}

		const menu = new StringSelectMenuBuilder()
			.setCustomId(`${componentPrefix}set${service}_${interaction.message.id}_${trackID}_${requesterID}`)
			.setPlaceholder('Pick a replacement')
			.addOptions(choices.map(choice => {
				const option = new StringSelectMenuOptionBuilder()
					.setLabel(truncated(choice.label || track.title, maxChoiceLength))
					.setValue(choice.value)

				return choice.description
					? option.setDescription(truncated(choice.description, maxChoiceLength))
					: option
			}))

		return interaction.editReply({
			content: `Alternatives for **${track.title}** — **${track.artist}**`,
			components: [new ActionRowBuilder().addComponents(menu)]
		}).catch(error => console.error(error))
	}

	/**
	 * Changes the given link on the result the interaction belongs to.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {string} service - service
	 * @param {string} target - target
	 *
	 * @returns {Promise<*>}
	 */
	async #applyAlternative(interaction, service, target) {
		const [messageID, trackID, requesterID] = target.split('_')
		const [value] = interaction.values

		await interaction.deferUpdate()

		const track = await catalog.trackByID(trackID)
		const message = await interaction.channel?.messages.fetch(messageID).catch(() => null)

		if (!track || !message) {
			return interaction.editReply({
				content: '❌ | That result is no longer available.',
				components: []
			}).catch(error => console.error(error))
		}

		const links = await catalog.linksFor(track)
		const requester = await this.client.users.fetch(requesterID).catch(() => interaction.user)
		const selection = this.#selectionFrom(message)

		selection[service] = service === 'video' ? catalog.youtubeURLFor(value) : value

		await message.edit(this.#resultPayload(requester, track, links, selection))
			.catch(error => console.error(error))

		return interaction.editReply({
			content: `✅ | The ${serviceNames[service]} has been changed.`,
			components: []
		}).catch(error => console.error(error))
	}

	/**
	 * The alternatives the given link can be changed to.
	 *
	 * @param {string} service - service
	 * @param {Object} track - track
	 *
	 * @returns {Promise<Object[]>} alternatives - alternatives
	 */
	async #alternativesFor(service, track) {
		if (service === 'video') {
			const videos = await this.#videosFor(track)

			return videos.map(video => ({
				value: video.id,
				label: video.title,
				description: `${video.author} · ${formatted(video.durationMS)}`
			}))
		}

		if (service === 'apple') {
			const songs = await catalog.appleCandidatesFor(track, maxVideoChoices)

			return songs.map(song => ({
				value: song.url,
				label: song.title,
				description: `${song.artist} · ${formatted(song.durationMS)}`
			}))
		}

		const candidates = await this.#spotifyCandidatesFor(track)
		const titles = await Promise.all(candidates.map(candidate => catalog.spotifyTitleFor(candidate.url)))

		return candidates.map((candidate, position) => ({
			value: candidate.url,
			label: titles[position] ?? candidate.release?.title ?? track.title,
			description: candidate.release
				? `${candidate.release.artist} · ${candidate.release.album}`
				: `${track.artist} · release ${position + 1}`
		}))
	}

	/**
	 * The Spotify links the given track and its sibling releases carry.
	 *
	 * @param {Object} track - track
	 *
	 * @returns {Promise<Object[]>} candidates - candidates
	 */
	async #spotifyCandidatesFor(track) {
		const links = await catalog.linksFor(track)
		const candidates = links.spotifyAll.map(url => ({ url: url, release: null }))

		if (candidates.length < 2) {
			const siblings = await catalog.searchTracks(`${track.artist} ${track.title}`.trim(), maxVideoChoices)

			for (const sibling of siblings.filter(item => item.id !== track.id).slice(0, maxSiblingLookups)) {
				const release = await catalog.trackByID(sibling.id)

				if (!release) {
					continue
				}

				for (const url of (await catalog.linksFor(release)).spotifyAll) {
					candidates.push({ url: url, release: release })
				}
			}
		}

		const seen = new Set()

		return candidates
			.filter(candidate => {
				if (seen.has(candidate.url)) {
					return false
				}

				seen.add(candidate.url)
				return true
			})
			.slice(0, maxVideoChoices)
	}

	/**
	 * The links the given result message currently shows.
	 *
	 * @param {Object} message - message
	 *
	 * @returns {Object} selection - selection
	 */
	#selectionFrom(message) {
		const lines = (message?.content ?? '').split('\n')
		const linkAfter = emoji => lines
			.find(line => line.startsWith(`${emoji} | `))
			?.slice(`${emoji} | `.length)
			.trim() ?? null

		return {
			video: linkAfter('📺'),
			apple: linkAfter('🍎'),
			spotify: linkAfter('🟢')
		}
	}

	/**
	 * The message showing the given track.
	 *
	 * @param {Object} user - user
	 * @param {Object} track - track
	 * @param {Object} links - links
	 * @param {Object} selection - selection
	 *
	 * @returns {Object} payload - payload
	 */
	#resultPayload(user, track, links, selection) {
		const searchURLs = catalog.searchURLsFor(track)
		const lines = [`🔎 | \`${track.title}\`, requested by <@${user.id}>`]
		const buttons = []
		const videoID = selection.video ? catalog.youtubeIDIn(selection.video) : null

		if (selection.video) {
			lines.push(`📺 | ${selection.video}`)
		}

		if (selection.apple) {
			lines.push(`🍎 | ${selection.apple}`)
		}

		if (selection.spotify) {
			lines.push(`🟢 | ${selection.spotify}`)
		}

		if (videoID) {
			buttons.push(new ButtonBuilder()
				.setCustomId(`${componentPrefix}queue_${videoID}`)
				.setLabel('Play in voice')
				.setEmoji('▶️')
				.setStyle(ButtonStyle.Primary))

			buttons.push(changeButton('video', 'Change video', '🔁', track, user))
		} else {
			buttons.push(linkButton('YouTube', '📺', searchURLs.youtube))
		}

		if (selection.apple) {
			buttons.push(changeButton('apple', 'Change Apple Music', '🍎', track, user))
		} else {
			buttons.push(linkButton('Apple Music', '🍎', searchURLs.appleMusic))
		}

		if (selection.spotify) {
			buttons.push(changeButton('spotify', 'Change Spotify', '🟢', track, user))
		} else {
			buttons.push(linkButton('Spotify', '🟢', searchURLs.spotify))
		}

		if (links.deezer) {
			buttons.push(linkButton('Deezer', '🎵', links.deezer))
		}

		if (links.tidal) {
			buttons.push(linkButton('Tidal', '🌊', links.tidal))
		}

		return {
			content: lines.join('\n'),
			components: rowsOf(buttons),
			allowedMentions: { parse: [] }
		}
	}
}

module.exports = {
	MusicManager: MusicManager,
	musicComponentPrefix: componentPrefix
}
