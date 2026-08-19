const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Interaction, MessageFlags, ModalBuilder, PermissionsBitField, TextInputBuilder, TextInputStyle, escapeMarkdown } = require('discord.js')
const { Database } = require('./database')

/** The app a drop links to. */
const appName = process.env['APP_NAME']

/** The color a report is embedded with. */
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The user an unrecognized control is reported to. */
const ownerID = process.env['OWNER_ID']

/** The minutes between two reads of the configured channels. */
const tickMinutes = Number(process.env['GIF_DROP_TICK_MINUTES'] ?? 10)

/** The hours between two drops in a channel that answers them. */
const intervalHours = Number(process.env['GIF_DROP_INTERVAL_HOURS'] ?? 6)

/** The hours between two drops in a channel that ignores them. */
const maxIntervalHours = Number(process.env['GIF_DROP_MAX_INTERVAL_HOURS'] ?? 48)

/** The minutes a drop is held back by at random. */
const jitterMinutes = Number(process.env['GIF_DROP_JITTER_MINUTES'] ?? 90)

/** The minutes a channel stays silent before it is dropped in. */
const quietGapMinutes = Number(process.env['GIF_DROP_QUIET_GAP_MINUTES'] ?? 45)

/** The days a channel may stay silent before its drops pause. */
const staleDays = Number(process.env['GIF_DROP_STALE_DAYS'] ?? 7)

/** The days an anime waits before it is dropped again. */
const repeatDays = Number(process.env['GIF_DROP_REPEAT_DAYS'] ?? 30)

/** The number of ignored drops the interval grows over. */
const maxQuietDrops = Math.max(0, Math.ceil(Math.log2(maxIntervalHours / intervalHours)))

/** The days a drop is remembered for. */
const historyDays = 180

/** The number of messages a rhythm is seeded from. */
const seedLimit = 100

/** The number of messages counted before the rhythm is read. */
const minimumSample = 40

/** The hours the rhythm is read over. */
const smoothingHours = 3

/** The share of the busiest hours a channel is awake at. */
const awakeShare = 0.25

/** The minutes a drop is given to collect a reaction or a reply. */
const scoreMinutes = 60

/** The messages a channel is read back over. */
const historyLimit = 25

/** The number of replies a drop is credited with. */
const replyLimit = 5

/** The reactions tried before an untitled GIF is dropped. */
const pickAttempts = 3

/** The GIFs fetched per attempt. */
const candidateCount = 20

/** The permissions a drop needs in a channel. */
const requiredPermissions = [
	PermissionsBitField.Flags.ViewChannel,
	PermissionsBitField.Flags.SendMessages,
	PermissionsBitField.Flags.AttachFiles,
	PermissionsBitField.Flags.ReadMessageHistory
]

/** The Discord error a deleted channel is reported with. */
const unknownChannelCode = 10003

/** The prefix on every report control’s custom id. */
const componentPrefix = 'gif_drop_'

/** The field the awake hours are written in. */
const hoursField = 'hours'

class GifDropManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client
	 */
	client

	/**
	 * @param {Database} db - db
	 */
	db

	/**
	 * @param {Object} gifManager - gif manager
	 */
	gifManager

	/**
	 * @param {Object} kurozoraManager - kurozora manager
	 */
	kurozoraManager

	/**
	 * @param {NodeJS.Timeout} timer - timer
	 */
	timer

	/**
	 * @param {boolean} isDropping - is dropping
	 */
	isDropping = false

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - client
	 * @param {Database} db - db
	 * @param {Object} gifManager - gif manager
	 * @param {Object} kurozoraManager - kurozora manager
	 */
	constructor(client, db, gifManager, kurozoraManager) {
		this.client = client
		this.db = db
		this.gifManager = gifManager
		this.kurozoraManager = kurozoraManager
	}

	// MARK: - Functions
	/**
	 * Starts reading the configured channels on an interval.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {
		if (!this.client.isReady()) {
			await new Promise(resolve => this.client.once('clientReady', resolve))
		}

		await this.tick()

		this.timer = setInterval(() => {
			this.tick()
				.catch(error => console.error(error))
		}, tickMinutes * 60 * 1000)

		const configured = await this.db.get('SELECT COUNT(*) AS channels FROM gif_drop_channels WHERE isEnabled = 1')

		console.log(`🎞️ Dropping anime GIFs in ${configured.channels} channels, one after every ${intervalHours}h of quiet.`)
	}

	/** Stops reading the configured channels. */
	stop() {
		clearInterval(this.timer)
		this.timer = null
	}

	/**
	 * Reads every configured channel and drops in the ones that are ready for it.
	 *
	 * @returns {Promise<void>}
	 */
	async tick() {
		if (this.isDropping) {
			return
		}

		this.isDropping = true

		try {
			const configs = await this.db.all('SELECT * FROM gif_drop_channels WHERE isEnabled = 1')

			for (const config of configs) {
				await this.evaluate(config)
					.catch(error => console.error(`Couldn’t drop a GIF in the server ${config.guildID}.`, error.message))
			}

			await this.prune()
		} finally {
			this.isDropping = false
		}
	}

	/**
	 * Scores the previous drop, then drops again when every gate is clear.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<void>}
	 */
	async evaluate(config) {
		const channel = await this.channel(config)

		if (!channel) {
			return
		}

		await this.score(config, channel)

		const messages = await this.history(channel, historyLimit)
		await this.learn(config, messages)

		if (await this.blocker(config, messages)) {
			return
		}

		const reason = await this.drop(config, channel)

		if (reason) {
			console.error(`Couldn’t drop a GIF in the channel ${channel.id} — ${reason}.`)
		}
	}

	/**
	 * The channel a server’s drops are posted in, or null when it is unusable.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<?TextChannel>} channel - channel
	 */
	async channel(config) {
		const channel = await this.client.channels.fetch(config.channelID)
			.catch(async error => {
				if (error.code === unknownChannelCode) {
					await this.disable(config.guildID)
					console.error(`GIF drops are off in the server ${config.guildID}. The channel ${config.channelID} was deleted.`)
				}

				return null
			})

		if (!channel?.isTextBased() || channel.isDMBased()) {
			return null
		}

		return this.missingPermissions(channel).length ? null : channel
	}

	/**
	 * The permissions a channel is missing for a drop.
	 *
	 * @param {TextChannel} channel - channel
	 *
	 * @returns {string[]} permissions - permissions
	 */
	missingPermissions(channel) {
		const member = channel.guild?.members.me
		const permissions = member ? channel.permissionsFor(member) : null
		return requiredPermissions
			.filter(permission => !permissions?.has(permission))
			.map(permission => new PermissionsBitField(permission).toArray()[0].replace(/([a-z])([A-Z])/g, '$1 $2'))
	}

	/**
	 * The messages a channel carries, newest first, or null when it can’t be read.
	 *
	 * @param {TextChannel} channel - channel
	 * @param {number} limit - limit
	 *
	 * @returns {Promise<?Collection>} messages - messages
	 */
	async history(channel, limit) {
		return channel.messages.fetch({ limit: limit })
			.catch(error => console.error(error)) ?? null
	}

	/**
	 * The reason a channel is not dropped in, or null when it is ready for one.
	 *
	 * @param {Object} config - config
	 * @param {?Collection} messages - messages
	 *
	 * @returns {Promise<?string>} reason - reason
	 */
	async blocker(config, messages) {
		if (!messages) {
			return 'the channel couldn’t be read'
		}

		if (!await this.isAwake(config)) {
			return 'the channel is asleep at this hour'
		}

		if (messages.first()?.id === config.messageID) {
			return 'the previous drop is still the last message'
		}

		const latest = messages.find(message => !message.author.bot)

		if (!latest) {
			return `only bots have written in the last ${historyLimit} messages`
		}

		const silentMinutes = (Date.now() - latest.createdTimestamp) / 60000

		if (silentMinutes > staleDays * 24 * 60) {
			return `nobody has written here in ${staleDays} days`
		}

		const dueAt = this.dueAt(config, latest.createdTimestamp)

		if (dueAt > Date.now()) {
			return `the next drop is due <t:${Math.floor(dueAt / 1000)}:R>`
		}

		if (silentMinutes < quietGapMinutes) {
			return 'a conversation is going on'
		}

		return null
	}

	/**
	 * Counts the hours a channel’s messages were written in.
	 *
	 * @param {Object} config - config
	 * @param {?Collection} messages - messages
	 *
	 * @returns {Promise<void>}
	 */
	async learn(config, messages) {
		if (!messages) {
			return
		}

		const counted = config.countedAt ? new Date(config.countedAt).getTime() : 0
		const written = messages.filter(message => !message.author.bot && message.createdTimestamp > counted)

		if (!written.size) {
			return
		}

		const hours = new Map()
		let newest = counted

		for (const message of written.values()) {
			const hour = new Date(message.createdTimestamp).getUTCHours()
			hours.set(hour, (hours.get(hour) ?? 0) + 1)
			newest = Math.max(newest, message.createdTimestamp)
		}

		for (const [hour, count] of hours) {
			await this.db.run(`INSERT INTO gif_drop_hours (guildID, hour, messages)
				VALUES (?, ?, ?)
				ON CONFLICT (guildID, hour) DO UPDATE SET messages = messages + excluded.messages`,
			config.guildID,
			hour,
			count)
		}

		config.countedAt = new Date(newest).toISOString()

		await this.db.run('UPDATE gif_drop_channels SET countedAt = ? WHERE guildID = ?', config.countedAt, config.guildID)
	}

	/**
	 * The messages a channel carries per hour of the day, in UTC.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<number[]>} rhythm - rhythm
	 */
	async rhythm(guildID) {
		const rows = await this.db.all('SELECT hour, messages FROM gif_drop_hours WHERE guildID = ?', guildID)
		const rhythm = Array.from({ length: 24 }, () => 0)

		rows.forEach(row => rhythm[row.hour] = row.messages)

		return rhythm
	}

	/**
	 * The messages a channel carries around the given hour.
	 *
	 * @param {number[]} rhythm - rhythm
	 * @param {number} hour - hour
	 *
	 * @returns {number} messages - messages
	 */
	around(rhythm, hour) {
		const reach = Math.floor(smoothingHours / 2)
		let messages = 0

		for (let offset = -reach; offset <= reach; offset++) {
			messages += rhythm[(hour + offset + 24) % 24]
		}

		return messages
	}

	/**
	 * The hours of the day a channel is awake at, and the messages they are read from.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<Object>} hours - hours
	 */
	async awakeHours(config) {
		const rhythm = await this.rhythm(config.guildID)
		const sample = rhythm.reduce((messages, hour) => messages + hour, 0)

		if (Number.isInteger(config.awakeFrom) && Number.isInteger(config.awakeTo)) {
			return { hours: this.chosenHours(config.awakeFrom, config.awakeTo), sample: sample, isLearned: false }
		}

		const busiest = Math.max(...rhythm.map((messages, hour) => this.around(rhythm, hour)))
		const hours = new Set()

		for (let hour = 0; hour < 24; hour++) {
			if (sample < minimumSample || this.around(rhythm, hour) >= busiest * awakeShare) {
				hours.add(hour)
			}
		}

		return { hours: hours, sample: sample, isLearned: true }
	}

	/**
	 * The hours of a range, from the first up to the last, or every hour when both
	 * are the same.
	 *
	 * @param {number} from - from
	 * @param {number} to - to
	 *
	 * @returns {Set<number>} hours - hours
	 */
	chosenHours(from, to) {
		const hours = new Set()

		if (from === to) {
			for (let hour = 0; hour < 24; hour++) {
				hours.add(hour)
			}

			return hours
		}

		for (let hour = from; hour !== to; hour = (hour + 1) % 24) {
			hours.add(hour)
		}

		return hours
	}

	/**
	 * Whether a channel is awake at this hour.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<boolean>} isAwake - is awake
	 */
	async isAwake(config) {
		const { hours } = await this.awakeHours(config)
		return hours.has(new Date().getUTCHours())
	}

	/**
	 * The hours a channel is awake at, written for a report.
	 *
	 * @param {Object} awake - awake
	 *
	 * @returns {string} text - text
	 */
	awakeText(awake) {
		const ranges = this.ranges(awake.hours)
		const window = ranges ? `${ranges} UTC` : 'around the clock'

		return awake.isLearned
			? `Awake ${window}, read from ${awake.sample} messages`
			: `Awake ${window}, set by hand`
	}

	/**
	 * Sets the hours a channel is awake at.
	 *
	 * @param {string} guildID - guild id
	 * @param {?number} from - from
	 * @param {?number} to - to
	 *
	 * @returns {Promise<void>}
	 */
	async chooseHours(guildID, from, to) {
		await this.db.run('UPDATE gif_drop_channels SET awakeFrom = ?, awakeTo = ? WHERE guildID = ?', from, to, guildID)
	}

	/**
	 * The range of hours the text holds, or null when it holds none.
	 *
	 * @param {string} text - text
	 *
	 * @returns {?Object} hours - hours
	 */
	parseHours(text) {
		const match = /^(\d{1,2})(?::00)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::00)?$/i.exec(text.trim())

		if (!match) {
			return null
		}

		const from = Number(match[1])
		const to = Number(match[2])

		if (from > 24 || to > 24) {
			return null
		}

		return { from: from % 24, to: to % 24 }
	}

	/**
	 * The hours written as ranges, or null when they span the clock.
	 *
	 * @param {Set<number>} hours - hours
	 *
	 * @returns {?string} ranges - ranges
	 */
	ranges(hours) {
		if (!hours.size || hours.size === 24) {
			return null
		}

		const clock = Array.from({ length: 24 }, (value, hour) => hour)
		const openings = clock.filter(hour => hours.has(hour) && !hours.has((hour + 23) % 24))

		return openings.map(opening => {
			let closing = opening

			while (hours.has((closing + 1) % 24)) {
				closing = (closing + 1) % 24
			}

			return `${this.clock(opening)}–${this.clock((closing + 1) % 24)}`
		}).join(', ')
	}

	/**
	 * The hour written as a time of day.
	 *
	 * @param {number} hour - hour
	 *
	 * @returns {string} time - time
	 */
	clock(hour) {
		return `${String(hour).padStart(2, '0')}:00`
	}

	/**
	 * The moment a channel is ready for its next drop, counted from its newest
	 * message or drop, whichever came last.
	 *
	 * @param {Object} config - config
	 * @param {?number} activeAt - active at
	 *
	 * @returns {number} dueAt - due at
	 */
	dueAt(config, activeAt) {
		const droppedAt = config.droppedAt ? new Date(config.droppedAt).getTime() : 0
		const since = Math.max(droppedAt, activeAt ?? 0)

		if (!since) {
			return 0
		}

		return since + (this.intervalOf(config) * 60 + config.jitter) * 60 * 1000
	}

	/**
	 * The hours a channel waits between two drops.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {number} hours - hours
	 */
	intervalOf(config) {
		return Math.min(intervalHours * Math.pow(2, config.quietDrops), maxIntervalHours)
	}

	/**
	 * Counts the reactions and replies the previous drop collected.
	 *
	 * @param {Object} config - config
	 * @param {TextChannel} channel - channel
	 *
	 * @returns {Promise<void>}
	 */
	async score(config, channel) {
		if (config.isScored || !config.messageID) {
			return
		}

		if (Date.now() - new Date(config.droppedAt).getTime() < scoreMinutes * 60 * 1000) {
			return
		}

		const message = await channel.messages.fetch(config.messageID)
			.catch(() => null)
		const reactions = message?.reactions.cache.reduce((count, reaction) => count + reaction.count, 0) ?? 0
		const replies = message
			? await channel.messages.fetch({ after: config.messageID, limit: replyLimit })
				.then(messages => messages.filter(reply => !reply.author.bot).size)
				.catch(() => 0)
			: 0
		const quietDrops = reactions || replies ? 0 : Math.min(config.quietDrops + 1, maxQuietDrops)

		config.quietDrops = quietDrops
		config.isScored = 1

		await this.db.run('UPDATE gif_drop_channels SET quietDrops = ?, isScored = 1 WHERE guildID = ?', quietDrops, config.guildID)
	}

	/**
	 * Posts a GIF nobody has seen here yet.
	 *
	 * @param {Object} config - config
	 * @param {TextChannel} channel - channel
	 *
	 * @returns {Promise<?string>} reason - reason
	 */
	async drop(config, channel) {
		const gif = await this.pick(config.guildID)

		if (!gif) {
			return 'no unseen GIF could be fetched'
		}

		const attachment = await this.gifManager.attachment(gif.url)

		if (!attachment) {
			return 'the GIF couldn’t be downloaded'
		}

		const url = gif.title
			? await this.kurozoraManager.animeURL(gif.title)
				.catch(error => console.error(error))
			: null
		const payload = {
			files: [attachment],
			flags: MessageFlags.SuppressEmbeds,
			allowedMentions: { parse: [] }
		}

		if (gif.title) {
			payload.content = `-# ${escapeMarkdown(gif.title)}`
		}

		if (url) {
			payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder()
				.setLabel(`View on ${appName}`)
				.setStyle(ButtonStyle.Link)
				.setURL(url))]
		}

		const message = await channel.send(payload)
			.catch(error => console.error(error))

		if (!message) {
			return 'the GIF couldn’t be posted'
		}

		await this.record(config, gif, message)

		return null
	}

	/**
	 * A GIF the server hasn’t been shown recently.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<?Object>} gif - gif
	 */
	async pick(guildID) {
		let fallback = null

		for (let attempt = 0; attempt < pickAttempts; attempt++) {
			const reaction = this.gifManager.randomDropReaction()
			const gifs = await this.gifManager.gifs(reaction, null, candidateCount)
			const unseen = []

			for (const gif of gifs) {
				if (!await this.isSeen(guildID, gif)) {
					unseen.push(gif)
				}
			}

			const titled = unseen.filter(gif => gif.title)

			if (titled.length) {
				return this.sample(titled)
			}

			fallback = fallback ?? (unseen.length ? this.sample(unseen) : null)
		}

		return fallback
	}

	/**
	 * Whether a server has been shown the GIF, or its anime, recently.
	 *
	 * @param {string} guildID - guild id
	 * @param {Object} gif - gif
	 *
	 * @returns {Promise<boolean>} isSeen - is seen
	 */
	async isSeen(guildID, gif) {
		if (await this.db.get('SELECT 1 FROM gif_drops WHERE guildID = ? AND url = ?', guildID, gif.url)) {
			return true
		}

		if (!gif.title) {
			return false
		}

		const since = new Date(Date.now() - repeatDays * 24 * 60 * 60 * 1000).toISOString()
		const row = await this.db.get('SELECT 1 FROM gif_drops WHERE guildID = ? AND title = ? AND droppedAt >= ?', guildID, gif.title, since)

		return !!row
	}

	/**
	 * A random one of the given GIFs.
	 *
	 * @param {Object[]} gifs - gifs
	 *
	 * @returns {Object} gif - gif
	 */
	sample(gifs) {
		return gifs[Math.floor(Math.random() * gifs.length)]
	}

	/**
	 * Marks a GIF as dropped.
	 *
	 * @param {Object} config - config
	 * @param {Object} gif - gif
	 * @param {Message} message - message
	 *
	 * @returns {Promise<void>}
	 */
	async record(config, gif, message) {
		const droppedAt = new Date().toISOString()
		const jitter = Math.floor(Math.random() * jitterMinutes)

		config.droppedAt = droppedAt
		config.messageID = message.id
		config.jitter = jitter
		config.isScored = 0

		await this.db.run(
			'UPDATE gif_drop_channels SET droppedAt = ?, messageID = ?, jitter = ?, isScored = 0 WHERE guildID = ?',
			droppedAt,
			message.id,
			jitter,
			config.guildID
		)
		await this.db.run(
			'INSERT OR REPLACE INTO gif_drops (guildID, url, title, droppedAt) VALUES (?, ?, ?, ?)',
			config.guildID,
			gif.url,
			gif.title,
			droppedAt
		)
	}

	/**
	 * Forgets the drops that are older than the history allows.
	 *
	 * @returns {Promise<void>}
	 */
	async prune() {
		const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000).toISOString()
		await this.db.run('DELETE FROM gif_drops WHERE droppedAt < ?', since)
	}

	/**
	 * The channel a server’s drops are configured for.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<?Object>} config - config
	 */
	async config(guildID) {
		return await this.db.get('SELECT * FROM gif_drop_channels WHERE guildID = ?', guildID) ?? null
	}

	/**
	 * Turns a server’s drops off.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<void>}
	 */
	async disable(guildID) {
		await this.db.run('UPDATE gif_drop_channels SET isEnabled = 0 WHERE guildID = ?', guildID)
	}

	/**
	 * Handles the selected subcommand.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handle(interaction) {
		if (!interaction.inGuild()) {
			return interaction.reply({
				content: 'GIF drops are configured per server.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}


		switch (interaction.options.getSubcommand()) {
			case 'set': {
				return this.setChannel(interaction)
			}
			case 'off': {
				return this.turnOff(interaction)
			}
			case 'now': {
				return this.dropNow(interaction)
			}
			default: {
				return this.report(interaction)
			}
		}
	}

	/**
	 * Points a server’s drops at the chosen channel.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async setChannel(interaction) {
		const channel = interaction.options.getChannel('channel')
		const missing = this.missingPermissions(channel)

		if (missing.length) {
			return interaction.reply({
				content: `I need ${missing.map(permission => `**${permission}**`).join(', ')} in <#${channel.id}> to drop GIFs there.`,
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		const previous = await this.config(interaction.guildId)

		await this.db.run(`INSERT INTO gif_drop_channels (guildID, channelID, isEnabled, configuredAt)
			VALUES (?, ?, 1, ?)
			ON CONFLICT (guildID) DO UPDATE SET
				isEnabled = 1,
				configuredAt = excluded.configuredAt,
				droppedAt = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.droppedAt END,
				messageID = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.messageID END,
				jitter = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.jitter ELSE 0 END,
				quietDrops = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.quietDrops ELSE 0 END,
				isScored = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.isScored ELSE 1 END,
				countedAt = CASE WHEN gif_drop_channels.channelID = excluded.channelID THEN gif_drop_channels.countedAt END,
				channelID = excluded.channelID`,
		interaction.guildId,
		channel.id,
		new Date().toISOString())

		if (previous?.channelID !== channel.id) {
			await this.db.run('DELETE FROM gif_drop_hours WHERE guildID = ?', interaction.guildId)
		}

		const config = await this.config(interaction.guildId)

		await this.learn(config, await this.history(channel, seedLimit))
			.catch(error => console.error(error))

		return interaction.editReply({
			content: `Anime GIFs will drop in <#${channel.id}>, at most one every ${intervalHours} hours and only after ${quietGapMinutes} minutes of silence.`,
			...await this.payload(config)
		}).catch(error => console.error(error))
	}

	/**
	 * Turns a server’s drops off.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async turnOff(interaction) {
		const config = await this.config(interaction.guildId)

		if (!config?.isEnabled) {
			return interaction.reply({
				content: 'GIF drops are already off.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		await this.disable(interaction.guildId)

		return interaction.editReply({
			content: 'GIF drops are off.',
			...await this.payload(await this.config(interaction.guildId))
		}).catch(error => console.error(error))
	}

	/**
	 * Drops in a server’s channel without waiting for a gate to clear.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async dropNow(interaction) {
		const config = await this.config(interaction.guildId)

		if (!config) {
			return interaction.reply({
				content: 'No channel is set. Run `/gifdrop set` first.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		const channel = await this.channel(config)

		if (!channel) {
			return interaction.editReply(`<#${config.channelID}> can’t be posted in.`)
				.catch(error => console.error(error))
		}

		const reason = await this.drop(config, channel)

		return interaction.editReply(reason
			? `Nothing was dropped — ${reason}.`
			: `Dropped a GIF in <#${channel.id}>.`)
			.catch(error => console.error(error))
	}

	/**
	 * Reports a server’s drop schedule.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async report(interaction) {
		const config = await this.config(interaction.guildId)

		if (!config) {
			return interaction.reply({
				content: 'No channel is set. Run `/gifdrop set` to have anime GIFs drop in a channel.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		return interaction.editReply(await this.payload(config))
			.catch(error => console.error(error))
	}

	/**
	 * A server’s drop schedule, and the controls it is changed with.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<Object>} payload - payload
	 */
	async payload(config) {
		const target = await this.client.channels.fetch(config.channelID)
			.catch(() => null)
		const missing = target ? this.missingPermissions(target) : []
		const channel = config.isEnabled && target && !missing.length ? target : null
		const messages = channel ? await this.history(channel, historyLimit) : null

		await this.learn(config, messages)

		const blocker = channel ? await this.blocker(config, messages) : null
		const awake = await this.awakeHours(config)
		const dropped = await this.db.get('SELECT COUNT(*) AS drops FROM gif_drops WHERE guildID = ?', config.guildID)
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('GIF Drops')
			.addFields({
				name: 'Channel',
				value: `<#${config.channelID}>`,
				inline: true
			}, {
				name: 'State',
				value: config.isEnabled ? 'On' : 'Off',
				inline: true
			}, {
				name: 'Every',
				value: `${this.intervalOf(config)}h`,
				inline: true
			}, {
				name: 'Last drop',
				value: config.droppedAt ? `<t:${Math.floor(new Date(config.droppedAt).getTime() / 1000)}:R>` : 'Never',
				inline: true
			}, {
				name: 'Ignored in a row',
				value: `${config.quietDrops}`,
				inline: true
			}, {
				name: 'Anime shown',
				value: `${dropped.drops}`,
				inline: true
			}, {
				name: 'Next drop',
				value: this.forecast(config, target, missing, blocker)
			})
			.setFooter({ text: [
				'Counted from the newest message or drop',
				this.awakeText(awake),
				`Paused after ${staleDays} quiet days`
			].join(' · ') })

		return { embeds: [embed], components: [this.controls(config, awake)] }
	}

	/**
	 * The controls a report is changed with.
	 *
	 * @param {Object} config - config
	 * @param {Object} awake - awake
	 *
	 * @returns {ActionRowBuilder} controls - controls
	 */
	controls(config, awake) {
		return new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}toggle`)
				.setLabel(config.isEnabled ? 'Turn off' : 'Turn on')
				.setStyle(config.isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}always`)
				.setLabel('Awake 24/7')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(!awake.isLearned && awake.hours.size === 24),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}hours`)
				.setLabel('Set hours…')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}learn`)
				.setLabel('Learn hours')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(awake.isLearned)
		)
	}

	/**
	 * The modal the awake hours are written in.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {ModalBuilder} modal - modal
	 */
	hoursModal(config) {
		const hours = new TextInputBuilder()
			.setCustomId(hoursField)
			.setLabel('Hours in UTC')
			.setPlaceholder('10-23, or 0-24 for around the clock')
			.setStyle(TextInputStyle.Short)
			.setMaxLength(13)
			.setRequired(true)

		if (Number.isInteger(config.awakeFrom) && Number.isInteger(config.awakeTo)) {
			hours.setValue(`${this.clock(config.awakeFrom)}-${this.clock(config.awakeTo)}`)
		}

		return new ModalBuilder()
			.setCustomId(`${componentPrefix}modal`)
			.setTitle('Awake hours')
			.addComponents(new ActionRowBuilder().addComponents(hours))
	}

	/**
	 * Handles the selected control.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handleComponent(interaction) {

		const config = await this.config(interaction.guildId)

		if (!config) {
			return interaction.reply({
				content: 'No channel is set. Run `/gifdrop set` to have anime GIFs drop in a channel.',
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		if (interaction.isModalSubmit()) {
			return this.submitHours(interaction, config)
		}

		const action = interaction.customId.slice(componentPrefix.length)

		if (action === 'hours') {
			return interaction.showModal(this.hoursModal(config))
				.catch(error => console.error(error))
		}

		switch (action) {
			case 'toggle': {
				await this.db.run('UPDATE gif_drop_channels SET isEnabled = ? WHERE guildID = ?', config.isEnabled ? 0 : 1, config.guildID)
				break
			}
			case 'always': {
				await this.chooseHours(config.guildID, 0, 0)
				break
			}
			case 'learn': {
				await this.chooseHours(config.guildID, null, null)
				break
			}
			default: {
				return interaction.reply({
					content: `This control is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
					flags: MessageFlags.Ephemeral
				}).catch(error => console.error(error))
			}
		}

		return this.refresh(interaction)
	}

	/**
	 * Sets the hours the member wrote.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Object} config - config
	 *
	 * @returns {Promise<*>}
	 */
	async submitHours(interaction, config) {
		const written = interaction.fields.getTextInputValue(hoursField)
		const hours = this.parseHours(written)

		if (!hours) {
			return interaction.reply({
				content: `“${written}” isn’t a range of hours. Write it as \`10-23\`, or \`0-24\` to stay awake around the clock.`,
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await this.chooseHours(config.guildID, hours.from, hours.to)

		return this.refresh(interaction)
	}

	/**
	 * Shows the report again.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async refresh(interaction) {
		await interaction.deferUpdate()
			.catch(error => console.error(error))

		return interaction.editReply(await this.payload(await this.config(interaction.guildId)))
			.catch(error => console.error(error))
	}

	/**
	 * The line a report closes with.
	 *
	 * @param {Object} config - config
	 * @param {?TextChannel} channel - channel
	 * @param {string[]} missing - missing
	 * @param {?string} blocker - blocker
	 *
	 * @returns {string} forecast - forecast
	 */
	forecast(config, channel, missing, blocker) {
		if (!config.isEnabled) {
			return 'Never — drops are off. Run `/gifdrop set` to turn them back on.'
		}

		if (!channel) {
			return `Never — <#${config.channelID}> is gone. Run \`/gifdrop set\` to pick another channel.`
		}

		if (missing.length) {
			return `Never — I need ${missing.map(permission => `**${permission}**`).join(', ')} in <#${channel.id}>.`
		}

		return blocker
			? `Waiting — ${blocker}.`
			: 'At the next check.'
	}
}

module.exports = {
	GifDropManager: GifDropManager,
	gifDropComponentPrefix: componentPrefix
}
