const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Interaction, LabelBuilder, escapeMarkdown, MessageFlags, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, parseEmoji } = require('discord.js')
const { Database } = require('./database')
const { bar, label } = require('./charts')
const shortcodeNames = require('emojibase-data/en/shortcodes/github.json')
const emojiList = require('emojibase-data/en/compact.json')

/** The color a poll is drawn with. */
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The user a failure is reported to. */
const ownerID = process.env['OWNER_ID']

/** The prefix a poll’s components are identified with. */
const pollComponentPrefix = 'poll'

/** The role a poll is created and closed with. */
const managerRole = 'Poll Manager'

/** The options a poll holds. */
const optionLimit = 25

/** The characters an option is drawn with. */
const optionLength = 80

/** The characters a menu entry holds. */
const labelLimit = 100

/** The characters the standings are drawn with. */
const chartLimit = 980

/** The cells a standing’s bar spans. */
const resultWidth = 12

/** The cell the unfilled part of a standing’s bar is drawn with. */
const resultTrack = '░'

/** The characters a standing draws a label with. */
const resultLength = 40

/** The seconds between two sweeps for polls that are due. */
const sweepSeconds = 30

/** The milliseconds a poll runs for at the least. */
const shortestRun = 60 * 1000

/** The milliseconds a poll runs for at the most. */
const longestRun = 365 * 24 * 60 * 60 * 1000

/** The milliseconds a unit of a duration counts for. */
const runUnits = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 }

/** The pattern a duration is read with. */
const runPattern = /(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)/gi

/** The pattern an option’s leading emoji is read with. */
const emojiPattern = /^(<a?:\w{2,32}:\d{17,20}>|:[\w+~\-]{2,32}:|\p{RGI_Emoji})\s+(.+)$/v

/** The durations a poll is written with. */
const runExamples = '`90m` · `12h` · `3d` · `1w` · `2d 6h`'

/** The pattern an emoji carrying a selector it doesn’t need is read with. */
const selectorPattern = /^\p{Emoji_Presentation}️$/u

/** The emoji a standard shortcode stands for. */
const shortcodes = new Map()

for (const entry of emojiList) {
	const names = shortcodeNames[entry.hexcode]

	if (!names) {
		continue
	}

	const emoji = selectorPattern.test(entry.unicode) ? entry.unicode.slice(0, -1) : entry.unicode

	for (const name of [names].flat()) {
		shortcodes.set(name, emoji)
	}
}

/**
 * The milliseconds a written duration counts for, or null when it reads as
 * anything else.
 *
 * @param {string} text - text
 *
 * @returns {number|null}
 */
function runLength(text) {
	let total = 0
	let counted = false

	const rest = text.replace(runPattern, (match, amount, unit) => {
		total += parseFloat(amount) * runUnits[unit[0].toLowerCase()]
		counted = true
		return ''
	})

	return counted && !rest.trim() ? total : null
}

/**
 * The stamp a date is written with.
 *
 * @param {string} date - date
 * @param {string} [style] - style
 *
 * @returns {string}
 */
function stamp(date, style = 'R') {
	return `<t:${Math.floor(Date.parse(date) / 1000)}:${style}>`
}

/**
 * Whether a failure reports an emoji a menu refused.
 *
 * @param {Error} error - error
 *
 * @returns {boolean}
 */
function refusedEmoji(error) {
	return error?.code === 50035 && JSON.stringify(error.rawError ?? '').includes('COMPONENT_INVALID_EMOJI')
}

class PollManager {
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
	 * @param {NodeJS.Timeout} timer - timer
	 */
	timer

	/**
	 * @param {Promise<void>} prepared - prepared
	 */
	prepared

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - client
	 * @param {Database} db - db
	 */
	constructor(client, db) {
		this.client = client
		this.db = db
		this.prepared = this.prepare()
	}

	// MARK: - Functions
	/**
	 * Builds the tables a poll is kept in.
	 *
	 * @returns {Promise<void>}
	 */
	async prepare() {
		await this.db.exec(`CREATE TABLE IF NOT EXISTS polls (
			messageID TEXT PRIMARY KEY,
			channelID TEXT NOT NULL,
			guildID TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT,
			live INTEGER NOT NULL DEFAULT 1,
			multiple INTEGER NOT NULL DEFAULT 0,
			closesAt TEXT
		)`)
		await this.db.exec(`CREATE TABLE IF NOT EXISTS poll_options (
			messageID TEXT NOT NULL,
			position INTEGER NOT NULL,
			emoji TEXT,
			label TEXT NOT NULL,
			PRIMARY KEY (messageID, position)
		)`)
		await this.db.exec(`CREATE TABLE IF NOT EXISTS poll_votes (
			messageID TEXT NOT NULL,
			position INTEGER NOT NULL,
			userID TEXT NOT NULL,
			PRIMARY KEY (messageID, userID, position)
		)`)

		await this.adopt()
	}

	/**
	 * Adopts the polls an earlier version left behind.
	 *
	 * @returns {Promise<void>}
	 */
	async adopt() {
		const tables = await this.db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'poll-%'`)

		for (const table of tables) {
			const messageID = table.name.slice('poll-'.length)

			try {
				const rows = await this.db.all(`SELECT * FROM "${table.name}"`)
				const poll = rows[0]
				const positions = new Map(rows
					.filter(row => row.pollItem)
					.map((row, position) => [row.pollItem, position]))

				if (poll && positions.size) {
					const voted = await this.db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, `user-${messageID}`)
					const votes = voted ? await this.db.all(`SELECT userId, pollItem FROM "user-${messageID}"`) : []

					await this.together(async () => {
						await this.db.run(`INSERT OR IGNORE INTO polls (messageID, channelID, guildID, title, description, live, multiple)
										   VALUES (?, ?, ?, ?, ?, ?, 0)`,
							messageID, `${poll.channelId}`, `${poll.guildId}`, `${poll.pollTitle ?? 'Poll'}`, `${poll.pollDesc ?? ''}`,
							poll.publicPoll === 'true' ? 1 : 0)

						for (const [item, position] of positions) {
							await this.db.run(`INSERT OR IGNORE INTO poll_options (messageID, position, emoji, label) VALUES (?, ?, NULL, ?)`,
								messageID, position, label(`${item}`, optionLength))
						}

						for (const vote of votes) {
							const position = positions.get(vote.pollItem)

							if (position !== undefined) {
								await this.db.run(`INSERT OR IGNORE INTO poll_votes (messageID, position, userID) VALUES (?, ?, ?)`,
									messageID, position, `${vote.userId}`)
							}
						}
					})
				}

				await this.db.exec(`DROP TABLE "${table.name}"`)
				await this.db.exec(`DROP TABLE IF EXISTS "user-${messageID}"`)
			} catch (error) {
				console.error(error)
			}
		}
	}

	/**
	 * Starts closing the polls that are due.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {
		await this.prepared

		if (!this.client.isReady()) {
			await new Promise(resolve => this.client.once('clientReady', resolve))
		}

		await this.sweep()

		for (const poll of await this.db.all(`SELECT * FROM polls`)) {
			await this.repost(poll)
				.catch(error => console.error(error))
		}

		this.timer = setInterval(() => {
			this.sweep()
				.catch(error => console.error(error))
		}, sweepSeconds * 1000)
	}

	/** Stops closing the polls that are due. */
	stop() {
		clearInterval(this.timer)
		this.timer = undefined
	}

	/**
	 * Closes the polls that are due.
	 *
	 * @returns {Promise<void>}
	 */
	async sweep() {
		await this.prepared

		const due = await this.db.all(`SELECT * FROM polls WHERE closesAt IS NOT NULL AND closesAt <= ?`, new Date().toISOString())

		for (const poll of due) {
			await this.conclude(poll, null)
				.catch(error => console.error(error))
		}
	}

	/**
	 * Closes a poll and draws it on the message it was posted as.
	 *
	 * @param {Object} poll - poll
	 * @param {string|null} closerID - closerID
	 *
	 * @returns {Promise<void>}
	 */
	async conclude(poll, closerID) {
		const message = await this.message(poll)
		const payload = await this.finish(poll, closerID)

		await message?.edit(payload)
	}

	/**
	 * Draws a poll on the message it was posted as. The poll is forgotten when
	 * the message is gone.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {Promise<void>}
	 */
	async repost(poll) {
		const message = await this.message(poll)

		if (!message) {
			return await this.forget(poll.messageID)
		}

		if (!(await this.options(poll.messageID)).length) {
			return await message.edit(await this.finish(poll, null))
		}

		await message.edit(await this.payload(poll))
	}

	/**
	 * The message a poll was posted as.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {Promise<Object|null>}
	 */
	async message(poll) {
		const channel = await this.client.channels.fetch(poll.channelID)
			.catch(() => null)

		return await channel?.messages.fetch(poll.messageID)
			.catch(() => null) ?? null
	}

	/**
	 * Runs the writes as one. Nothing is kept when any of them fails.
	 *
	 * @param {function(): Promise<void>} writes - writes
	 *
	 * @returns {Promise<void>}
	 */
	async together(writes) {
		await this.db.exec('BEGIN')

		try {
			await writes()
			await this.db.exec('COMMIT')
		} catch (error) {
			await this.db.exec('ROLLBACK')
			throw error
		}
	}

	/**
	 * Forgets a poll.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<void>}
	 */
	async forget(messageID) {
		await this.db.run(`DELETE FROM poll_votes WHERE messageID = ?`, messageID)
		await this.db.run(`DELETE FROM poll_options WHERE messageID = ?`, messageID)
		await this.db.run(`DELETE FROM polls WHERE messageID = ?`, messageID)
	}

	// MARK: - Creating
	/**
	 * Asks for a new poll.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async create(interaction, written = '') {
		if (!interaction.inGuild()) {
			return await interaction.reply({
				content: 'Polls run in servers only.',
				flags: MessageFlags.Ephemeral
			})
		}

		if (!await this.manages(interaction)) {
			return await interaction.reply({
				content: `Only members with the **${managerRole}** role can create polls. Ask an admin to run \`/poll\` for you.`,
				flags: MessageFlags.Ephemeral
			})
		}

		return await interaction.showModal(this.composer(written))
	}

	/**
	 * The modal a poll is written in.
	 *
	 * @param {string} [written] - written
	 *
	 * @returns {ModalBuilder}
	 */
	composer(written = '') {
		return new ModalBuilder()
			.setCustomId(`${pollComponentPrefix}_create`)
			.setTitle('New Poll')
			.addLabelComponents(
				new LabelBuilder()
					.setLabel('Question')
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('title')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(256)
						.setPlaceholder('Anime of the season?')),
				new LabelBuilder()
					.setLabel('Details')
					.setDescription('Optional.')
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('description')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(1000)),
				new LabelBuilder()
					.setLabel('Options')
					.setDescription('One per line. Start a line with an emoji or :shortcode: to give that option one.')
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('options')
						.setStyle(TextInputStyle.Paragraph)
						.setMaxLength(2000)
						.setValue(written.slice(0, 2000))
						.setPlaceholder('🥇 Frieren')),
				new LabelBuilder()
					.setLabel('Runs for')
					.setDescription('A minute to a year. Leave it empty to close the poll yourself.')
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('run')
						.setStyle(TextInputStyle.Short)
						.setRequired(false)
						.setMaxLength(32)
						.setPlaceholder('90m · 12h · 3d · 1w · 2d 6h')),
				new LabelBuilder()
					.setLabel('Settings')
					.setStringSelectMenuComponent(new StringSelectMenuBuilder()
						.setCustomId('settings')
						.setRequired(false)
						.setMinValues(0)
						.setMaxValues(3)
						.addOptions(
							{
								label: 'Show results live',
								value: 'live',
								description: 'Otherwise they stay hidden until the poll closes.',
								default: true
							},
							{
								label: 'Allow multiple answers',
								value: 'multiple',
								description: 'Voters pick as many options as they like.'
							},
							{
								label: 'Open a thread',
								value: 'thread',
								description: 'Discussion happens beside the poll.'
							}
						))
			)
	}

	/**
	 * Posts the poll a modal was written with.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async compose(interaction) {
		await this.prepared

		if (!await this.manages(interaction)) {
			return await interaction.reply({
				content: `Only members with the **${managerRole}** role can create polls.`,
				flags: MessageFlags.Ephemeral
			})
		}

		const title = interaction.fields.getTextInputValue('title').trim()
		const description = interaction.fields.getTextInputValue('description').trim()
		const written = interaction.fields.getTextInputValue('run').trim()
		const settings = new Set(interaction.fields.getStringSelectValues('settings'))
		const options = this.read(interaction.fields.getTextInputValue('options'), interaction.guild)

		if (options.length < 2) {
			return await interaction.reply({
				content: 'A poll needs at least two options, one per line.',
				flags: MessageFlags.Ephemeral
			})
		}

		if (options.length > optionLimit) {
			return await interaction.reply({
				content: `A poll holds up to ${optionLimit} options. Yours has ${options.length}.`,
				flags: MessageFlags.Ephemeral
			})
		}

		const run = written ? runLength(written) : null

		if (written && (run === null || run < shortestRun || run > longestRun)) {
			return await interaction.reply({
				content: `“${written}” doesn’t read as a duration between a minute and a year. Try ${runExamples}.`,
				flags: MessageFlags.Ephemeral
			})
		}

		await interaction.deferReply()

		const message = await interaction.fetchReply()
		const poll = {
			messageID: message.id,
			channelID: interaction.channelId,
			guildID: interaction.guildId,
			title: title,
			description: description,
			live: settings.has('live') ? 1 : 0,
			multiple: settings.has('multiple') ? 1 : 0,
			closesAt: run ? new Date(Date.now() + run).toISOString() : null
		}

		await this.together(async () => {
			await this.db.run(`INSERT INTO polls (messageID, channelID, guildID, title, description, live, multiple, closesAt)
							   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				poll.messageID, poll.channelID, poll.guildID, poll.title, poll.description,
				poll.live, poll.multiple, poll.closesAt)

			for (const option of options) {
				await this.db.run(`INSERT INTO poll_options (messageID, position, emoji, label) VALUES (?, ?, ?, ?)`,
					poll.messageID, option.position, option.emoji, option.label)
			}
		})

		await interaction.editReply(await this.payload(poll))
			.catch(async error => {
				if (!refusedEmoji(error)) {
					throw error
				}

				await this.unslot(poll.messageID)
				await interaction.editReply(await this.payload(poll))
			})

		if (settings.has('thread')) {
			await this.branch(interaction, message, title)
		}
	}

	/**
	 * The options a written list holds.
	 *
	 * @param {string} text - text
	 * @param {Object} [guild] - guild
	 *
	 * @returns {{position: number, emoji: string|null, label: string}[]}
	 */
	read(text, guild) {
		const options = []
		const seen = new Set()

		for (const line of text.split('\n')) {
			const written = line.trim()

			if (!written) {
				continue
			}

			const match = written.match(emojiPattern)
			const emoji = match ? this.emoji(match[1], guild) : null
			const name = label(emoji ? match[2] : written, optionLength)

			if (!name || seen.has(name)) {
				continue
			}

			seen.add(name)
			options.push({
				position: options.length,
				emoji: emoji,
				label: name
			})
		}

		return options
	}

	/**
	 * The emoji a written token stands for, or null when it stands for none.
	 * A `:name:` is read as one of the server’s own emoji before a standard one.
	 *
	 * @param {string} token - token
	 * @param {Object} [guild] - guild
	 *
	 * @returns {string|null}
	 */
	emoji(token, guild) {
		if (!token.startsWith(':') || !token.endsWith(':')) {
			return token
		}

		const written = token.slice(1, -1)

		for (const name of [written, written.replace(/~\d+$/, '')]) {
			const custom = guild?.emojis.cache.find(emoji => emoji.name === name)
				?? this.client.emojis?.cache?.find(emoji => emoji.name === name)

			if (custom) {
				return custom.toString()
			}

			if (shortcodes.has(name)) {
				return shortcodes.get(name)
			}
		}

		return null
	}

	/**
	 * Opens a thread beside a poll.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Object} message - message
	 * @param {string} title - title
	 *
	 * @returns {Promise<void>}
	 */
	async branch(interaction, message, title) {
		if (!interaction.channel.permissionsFor(interaction.applicationId)?.has(PermissionFlagsBits.CreatePublicThreads)) {
			return await interaction.followUp({
				content: 'The thread wasn’t opened. Grant the **Create Public Threads** permission and try again.',
				flags: MessageFlags.Ephemeral
			})
		}

		await interaction.channel.threads.create({
			startMessage: message.id,
			name: label(title, 100),
			autoArchiveDuration: 1440,
			reason: 'Thread created for a poll.'
		}).catch(error => console.error(error))
	}

	// MARK: - Voting
	/**
	 * Handles a poll’s components.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async handleComponent(interaction) {
		await this.prepared

		switch (interaction.customId) {
			case `${pollComponentPrefix}_vote`:
				return await this.vote(interaction)
			case `${pollComponentPrefix}_retract`:
				return await this.retract(interaction)
			case `${pollComponentPrefix}_peek`:
				return await this.peek(interaction)
			case `${pollComponentPrefix}_close`:
				return await this.close(interaction)
			default:
				return await interaction.reply({
					content: `This poll is no longer available. Please notify **<@${ownerID}>** if it should be.`,
					flags: MessageFlags.Ephemeral
				})
		}
	}

	/**
	 * Casts a member’s vote.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async vote(interaction) {
		const poll = await this.poll(interaction.message.id)

		if (!poll) {
			return await this.expired(interaction)
		}

		const positions = interaction.values.map(value => parseInt(value, 10))
		const options = await this.options(poll.messageID)
		const chosen = options.filter(option => positions.includes(option.position))

		await this.db.run(`DELETE FROM poll_votes WHERE messageID = ? AND userID = ?`, poll.messageID, interaction.user.id)

		for (const option of chosen) {
			await this.db.run(`INSERT INTO poll_votes (messageID, position, userID) VALUES (?, ?, ?)`,
				poll.messageID, option.position, interaction.user.id)
		}

		await interaction.update(await this.payload(poll))

		if (poll.live) {
			return
		}

		return await interaction.followUp({
			content: `Voted for ${this.listed(chosen)}.`,
			flags: MessageFlags.Ephemeral
		})
	}

	/**
	 * The sentence a set of options is listed in.
	 *
	 * @param {Object[]} options - options
	 *
	 * @returns {string}
	 */
	listed(options) {
		return options.map(option => `**${option.label}**`).join(', ')
	}

	/**
	 * Takes back a member’s vote.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async retract(interaction) {
		const poll = await this.poll(interaction.message.id)

		if (!poll) {
			return await this.expired(interaction)
		}

		const removed = await this.db.run(`DELETE FROM poll_votes WHERE messageID = ? AND userID = ?`,
			poll.messageID, interaction.user.id)

		if (!removed.changes) {
			return await interaction.reply({
				content: 'You haven’t voted in this poll.',
				flags: MessageFlags.Ephemeral
			})
		}

		await interaction.update(await this.payload(poll))

		if (poll.live) {
			return
		}

		return await interaction.followUp({
			content: 'Your vote is taken back.',
			flags: MessageFlags.Ephemeral
		})
	}

	// MARK: - Managing
	/**
	 * Shares the standings of a hidden poll with its manager.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async peek(interaction) {
		const poll = await this.poll(interaction.message.id)

		if (!poll) {
			return await this.expired(interaction)
		}

		if (!await this.manages(interaction)) {
			return await interaction.reply({
				content: `Only members with the **${managerRole}** role can read a hidden poll.`,
				flags: MessageFlags.Ephemeral
			})
		}

		return await interaction.reply({
			embeds: [await this.embed({ ...poll, live: 1 })],
			flags: MessageFlags.Ephemeral
		})
	}

	/**
	 * Closes a poll.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async close(interaction) {
		const poll = await this.poll(interaction.message.id)

		if (!poll) {
			return await this.expired(interaction)
		}

		if (!await this.manages(interaction)) {
			return await interaction.reply({
				content: `Only members with the **${managerRole}** role can close a poll.`,
				flags: MessageFlags.Ephemeral
			})
		}

		return await interaction.update(await this.finish(poll, interaction.user.id))
	}

	/**
	 * The message a closed poll is drawn as. Everything the poll was kept in is
	 * forgotten.
	 *
	 * @param {Object} poll - poll
	 * @param {string|null} closerID - closerID
	 *
	 * @returns {Promise<Object>}
	 */
	async finish(poll, closerID) {
		const payload = await this.payload({
			...poll,
			closedAt: new Date().toISOString(),
			closedBy: closerID
		})

		await this.forget(poll.messageID)

		return payload
	}

	/**
	 * Whether a member manages polls. The role is created when the server lacks
	 * one.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<boolean>}
	 */
	async manages(interaction) {
		if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			return true
		}

		if (interaction.member?.roles?.cache?.some(role => role.name === managerRole)) {
			return true
		}

		if (!interaction.guild?.roles.cache.some(role => role.name === managerRole)) {
			await interaction.guild?.roles.create({
				name: managerRole,
				color: appColor,
				reason: 'Automatically creating "Poll Manager" for bot functions.'
			}).catch(error => console.error(error))
		}

		return false
	}

	// MARK: - Drawing
	/**
	 * The message a poll is drawn as.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {Promise<Object>}
	 */
	async payload(poll) {
		const embed = await this.embed(poll)

		if (poll.closedAt) {
			return { embeds: [embed], components: [] }
		}

		return {
			embeds: [embed],
			components: [
				await this.chooser(poll),
				this.controls(poll)
			]
		}
	}

	/**
	 * The embed a poll is drawn in.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {Promise<EmbedBuilder>}
	 */
	async embed(poll) {
		const options = await this.options(poll.messageID)
		const counts = await this.counts(poll.messageID)
		const votes = [...counts.values()].reduce((total, count) => total + count, 0)
		const voters = await this.voters(poll.messageID)

		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(poll.title)
			.setDescription([poll.description, this.status(poll)].filter(Boolean).join('\n\n'))

		if (poll.live || poll.closedAt) {
			embed.addFields(this.standings(poll, options, counts, votes, voters))
		} else {
			embed.addFields({
				name: 'Hidden',
				value: `**${voters}** ${voters === 1 ? 'person has' : 'people have'} voted. The results show when the poll closes.`
			})
		}

		if (poll.closedBy) {
			embed.setFooter({ text: 'Closed early' })
		}

		return embed
	}

	/**
	 * The line a poll’s deadline is drawn as.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {string}
	 */
	status(poll) {
		if (poll.closedAt) {
			return poll.closedBy
				? `Closed ${stamp(poll.closedAt)} by <@${poll.closedBy}>.`
				: `Closed ${stamp(poll.closedAt)}.`
		}

		return poll.closesAt ? `Closes ${stamp(poll.closesAt)}.` : 'Closes when a poll manager says so.'
	}

	/**
	 * The field a poll’s standings are drawn in.
	 *
	 * @param {Object} poll - poll
	 * @param {Object[]} options - options
	 * @param {Map<number, number>} counts - counts
	 * @param {number} votes - votes
	 * @param {number} voters - voters
	 *
	 * @returns {{name: string, value: string}}
	 */
	standings(poll, options, counts, votes, voters) {
		const total = poll.multiple ? voters : votes
		const entries = options
			.map(option => ({
				emoji: option.emoji,
				label: escapeMarkdown(label(option.label, resultLength)),
				value: counts.get(option.position) ?? 0
			}))
			.sort((first, second) => second.value - first.value)
		const highest = Math.max(...entries.map(entry => entry.value))
		const drawn = entry => {
			const share = total ? Math.round((entry.value / total) * 100) : 0
			const name = entry.emoji ? `${entry.emoji} ${entry.label}` : entry.label

			return `${bar(entry.value, highest, resultWidth, resultTrack)} \`${share}%\` ${name} · ${entry.value}`
		}

		let shown = entries
		let chart = shown.map(drawn).join('\n')

		while (shown.length > 1 && chart.length > chartLimit) {
			shown = shown.slice(0, -1)
			chart = shown.map(drawn).join('\n')
		}

		const hidden = entries.length - shown.length
		const name = poll.multiple
			? `Results · ${votes} vote${votes === 1 ? '' : 's'} from ${voters} ${voters === 1 ? 'person' : 'people'}`
			: `Results · ${votes} vote${votes === 1 ? '' : 's'}`

		return {
			name: name,
			value: `${chart}${hidden ? `\n…and ${hidden} more` : ''}`
		}
	}

	/**
	 * The menu a poll is voted in.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {Promise<ActionRowBuilder>}
	 */
	async chooser(poll) {
		const options = (await this.options(poll.messageID)).slice(0, optionLimit)

		return new ActionRowBuilder()
			.addComponents(new StringSelectMenuBuilder()
				.setCustomId(`${pollComponentPrefix}_vote`)
				.setPlaceholder(poll.multiple ? 'Select one or more options…' : 'Select an option…')
				.setMinValues(1)
				.setMaxValues(poll.multiple ? options.length : 1)
				.addOptions(options.map(option => this.choice(option))))
	}

	/**
	 * The entry a menu draws an option as.
	 *
	 * @param {Object} option - option
	 *
	 * @returns {Object}
	 */
	choice(option) {
		const slot = this.slotted(option.emoji)

		return {
			label: option.label.slice(0, labelLimit),
			value: `${option.position}`,
			...(slot ? { emoji: slot } : {})
		}
	}

	/**
	 * The emoji a menu draws in its own slot, or null when it draws none.
	 *
	 * @param {string|null} emoji - emoji
	 *
	 * @returns {Object|null}
	 */
	slotted(emoji) {
		if (!emoji) {
			return null
		}

		const custom = parseEmoji(emoji)

		return custom?.id ? custom : { name: emoji }
	}

	/**
	 * Folds a poll’s standard emoji into the labels they were read from.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<void>}
	 */
	async unslot(messageID) {
		await this.db.run(`UPDATE poll_options SET label = emoji || ' ' || label, emoji = NULL
						   WHERE messageID = ? AND emoji IS NOT NULL AND emoji NOT LIKE '<%'`, messageID)
	}

	/**
	 * The buttons a poll is managed with.
	 *
	 * @param {Object} poll - poll
	 *
	 * @returns {ActionRowBuilder}
	 */
	controls(poll) {
		const row = new ActionRowBuilder()
			.addComponents(new ButtonBuilder()
				.setCustomId(`${pollComponentPrefix}_retract`)
				.setLabel('Retract Vote')
				.setStyle(ButtonStyle.Secondary))

		if (!poll.live) {
			row.addComponents(new ButtonBuilder()
				.setCustomId(`${pollComponentPrefix}_peek`)
				.setLabel('Peek Results')
				.setStyle(ButtonStyle.Secondary))
		}

		return row.addComponents(new ButtonBuilder()
			.setCustomId(`${pollComponentPrefix}_close`)
			.setLabel('Close Poll')
			.setStyle(ButtonStyle.Danger))
	}

	/**
	 * Reports that a poll is gone.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async expired(interaction) {
		return await interaction.reply({
			content: 'This poll is closed.',
			flags: MessageFlags.Ephemeral
		})
	}

	// MARK: - Reading
	/**
	 * The poll a message holds.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<Object|undefined>}
	 */
	async poll(messageID) {
		return await this.db.get(`SELECT * FROM polls WHERE messageID = ?`, messageID)
	}

	/**
	 * The options a poll holds.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<Object[]>}
	 */
	async options(messageID) {
		return await this.db.all(`SELECT position, emoji, label FROM poll_options WHERE messageID = ? ORDER BY position`, messageID)
	}

	/**
	 * The votes each of a poll’s options holds.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<Map<number, number>>}
	 */
	async counts(messageID) {
		const rows = await this.db.all(`SELECT position, COUNT(*) AS votes FROM poll_votes WHERE messageID = ? GROUP BY position`, messageID)

		return new Map(rows.map(row => [row.position, row.votes]))
	}

	/**
	 * The members a poll was voted in by.
	 *
	 * @param {string} messageID - messageID
	 *
	 * @returns {Promise<number>}
	 */
	async voters(messageID) {
		const row = await this.db.get(`SELECT COUNT(DISTINCT userID) AS voters FROM poll_votes WHERE messageID = ?`, messageID)

		return row?.voters ?? 0
	}
}

module.exports = {
	PollManager: PollManager,
	pollComponentPrefix: pollComponentPrefix
}
