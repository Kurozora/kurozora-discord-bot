const { Client, EmbedBuilder, Interaction, MessageFlags, escapeMarkdown } = require('discord.js')
const { Database } = require('./database')
const { barChart, label, trend } = require('./charts')

/** The bot the reach is reported for. */
const appNickname = process.env['APP_NICKNAME']

/** The color the report is embedded with. */
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The user the report is shared with. */
const ownerID = process.env['OWNER_ID']

/** The minutes between two writes of the reach. */
const snapshotMinutes = 60

/** The days a trend is drawn over. */
const trendDays = 30

/** The days the rankings are counted over. */
const rankingDays = 7

/** The commands a ranking lists. */
const commandLimit = 8

/** The servers a ranking lists. */
const serverLimit = 5

/** The servers the arrivals list. */
const arrivalLimit = 3

/** The characters a server name is drawn with. */
const nameLength = 22

/** The command the report is read with. It is left out of the counts. */
const reportCommand = '/stats'

class StatsManager {
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
	}

	// MARK: - Functions
	/**
	 * Starts writing the reach on an interval.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {

		if (!this.client.isReady()) {
			await new Promise(resolve => this.client.once('clientReady', resolve))
		}

		await this.snapshot()

		this.client.on('guildCreate', guild => {
			this.snapshot()
				.catch(error => console.error(error))
		})

		this.client.on('guildDelete', guild => {
			this.markLeft(guild.id)
				.catch(error => console.error(error))
		})

		this.timer = setInterval(() => {
			this.snapshot()
				.catch(error => console.error(error))
		}, snapshotMinutes * 60 * 1000)

		const reach = await this.db.get('SELECT guilds, members FROM stats_daily WHERE day = ?', this.day())
		console.log(`📊 Reaching ${reach.members.toLocaleString('en-US')} members across ${reach.guilds} servers.`)
	}

	/** Stops writing the reach. */
	stop() {
		clearInterval(this.timer)
		this.timer = null
	}

	/**
	 * Counts an interaction against the day it was created on. Nothing but the
	 * command it names and the server it came from is read.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async record(interaction) {
		const command = this.commandName(interaction)

		if (command === reportCommand) {
			return
		}


		const day = this.day()

		await this.db.run(`INSERT INTO stats_commands (day, command, invocations) VALUES (?, ?, 1)
			ON CONFLICT (day, command) DO UPDATE SET invocations = invocations + 1`, day, command)

		if (interaction.guildId) {
			await this.db.run(`INSERT INTO stats_guild_usage (day, guildID, invocations) VALUES (?, ?, 1)
				ON CONFLICT (day, guildID) DO UPDATE SET invocations = invocations + 1`, day, interaction.guildId)
		}
	}

	/**
	 * Writes the servers the bot is in and the members they hold.
	 *
	 * @returns {Promise<void>}
	 */
	async snapshot() {
		const day = this.day()
		const guilds = this.client.guilds.cache
		const members = guilds.reduce((total, guild) => total + (guild.memberCount ?? 0), 0)

		await this.db.run(`INSERT INTO stats_daily (day, guilds, members) VALUES (?, ?, ?)
			ON CONFLICT (day) DO UPDATE SET guilds = excluded.guilds, members = excluded.members`, day, guilds.size, members)

		for (const guild of guilds.values()) {
			await this.db.run(`INSERT INTO stats_guilds (guildID, name, members, joinedAt, leftAt) VALUES (?, ?, ?, ?, NULL)
				ON CONFLICT (guildID) DO UPDATE SET name = excluded.name, members = excluded.members, leftAt = NULL`,
				guild.id,
				guild.name,
				guild.memberCount ?? 0,
				guild.joinedTimestamp ? new Date(guild.joinedTimestamp).toISOString() : null
			)
		}
	}

	/**
	 * Marks a server as left.
	 *
	 * @param {string} guildID - guild id
	 *
	 * @returns {Promise<void>}
	 */
	async markLeft(guildID) {
		await this.db.run('UPDATE stats_guilds SET leftAt = ? WHERE guildID = ?', new Date().toISOString(), guildID)
		await this.snapshot()
	}

	/**
	 * Shares the reach, the usage, and the rankings with the owner.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<void>}
	 */
	async report(interaction) {
		if (interaction.user.id !== ownerID) {
			return interaction.reply({
				content: `Only **<@${ownerID}>** can read the stats.`,
				flags: MessageFlags.Ephemeral
			}).catch(error => console.error(error))
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		await this.snapshot()

		const since = this.day(-rankingDays + 1)
		const week = this.day(-7)
		const history = await this.history()
		const today = history[history.length - 1]
		const lastWeek = await this.db.get('SELECT * FROM stats_daily WHERE day <= ? ORDER BY day DESC LIMIT 1', week)
		const churn = await this.db.get(`SELECT
			(SELECT COUNT(*) FROM stats_guilds WHERE leftAt IS NULL AND joinedAt >= ?) AS arrived,
			(SELECT COUNT(*) FROM stats_guilds WHERE leftAt >= ?) AS departed`, week, week)
		const engaged = await this.db.get(`SELECT COUNT(*) AS guilds, COALESCE(SUM(members), 0) AS members FROM stats_guilds
			WHERE leftAt IS NULL AND guildID IN (SELECT guildID FROM stats_guild_usage WHERE day >= ?)`, since)
		const untouched = await this.db.get(`SELECT COUNT(*) AS guilds FROM stats_guilds
			WHERE leftAt IS NULL AND guildID NOT IN (SELECT guildID FROM stats_guild_usage)`)
		const commands = await this.db.all(`SELECT command, SUM(invocations) AS invocations FROM stats_commands
			WHERE day >= ? GROUP BY command ORDER BY invocations DESC LIMIT ?`, since, commandLimit)
		const busiest = await this.db.all(`SELECT stats_guilds.name AS name, SUM(stats_guild_usage.invocations) AS invocations
			FROM stats_guild_usage
			JOIN stats_guilds ON stats_guilds.guildID = stats_guild_usage.guildID
			WHERE stats_guild_usage.day >= ?
			GROUP BY stats_guild_usage.guildID ORDER BY invocations DESC LIMIT ?`, since, serverLimit)
		const arrivals = await this.db.all(`SELECT name, members, joinedAt FROM stats_guilds
			WHERE leftAt IS NULL AND joinedAt IS NOT NULL ORDER BY joinedAt DESC LIMIT ?`, arrivalLimit)
		const first = await this.db.get('SELECT MIN(day) AS day FROM stats_daily')
		const weekVolume = await this.db.get('SELECT COALESCE(SUM(invocations), 0) AS invocations FROM stats_commands WHERE day >= ?', since)
		const allTime = await this.db.get('SELECT COALESCE(SUM(invocations), 0) AS invocations FROM stats_commands')
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(`${appNickname} Usage`)
			.addFields({
				name: 'Servers',
				value: `**${today.guilds.toLocaleString('en-US')}**\n_+${churn.arrived} −${churn.departed} in 7d_`,
				inline: true
			}, {
				name: 'Commands',
				value: `**${weekVolume.invocations.toLocaleString('en-US')}** in 7d\n_${today.invocations.toLocaleString('en-US')} today_`,
				inline: true
			}, {
				name: 'Reach',
				value: `**${today.members.toLocaleString('en-US')}** members\n${this.delta(today.members, lastWeek?.members)}`,
				inline: true
			}, {
				name: `Servers that actually used it, ${rankingDays}d`,
				value: [
					`**${engaged.guilds.toLocaleString('en-US')}** of ${today.guilds.toLocaleString('en-US')} servers ran a command.`,
					`They hold **${engaged.members.toLocaleString('en-US')}** members — **${this.share(engaged.members, today.members)}** of reach.`,
					`**${untouched.guilds.toLocaleString('en-US')}** servers have never run one.`
				].join('\n')
			}, {
				name: `Commands a day, ${history.length}d`,
				value: this.block(trend(history.map(row => row.invocations)))
			}, {
				name: `Servers a day, ${history.length}d`,
				value: this.block(trend(history.map(row => row.activeGuilds)))
			})

		if (commands.length) {
			embed.addFields({
				name: `Commands, ${rankingDays}d`,
				value: this.block(barChart(commands.map(row => ({ label: row.command, value: row.invocations }))))
			})
		}

		if (busiest.length) {
			embed.addFields({
				name: `Busiest servers, ${rankingDays}d`,
				value: this.block(barChart(busiest.map(row => ({ label: this.name(row.name), value: row.invocations }))))
			})
		}

		if (arrivals.length) {
			embed.addFields({
				name: 'Newest servers',
				value: arrivals
					.map(row => `${escapeMarkdown(this.name(row.name, nameLength * 2))} · ${row.members.toLocaleString('en-US')} members · <t:${Math.floor(new Date(row.joinedAt).getTime() / 1000)}:R>`)
					.join('\n')
			})
		}

		embed.setFooter({ text: `${allTime.invocations.toLocaleString('en-US')} commands counted since ${first.day} · days are UTC` })
			.setTimestamp()

		return interaction.editReply({ embeds: [embed] })
			.catch(error => console.error(error))
	}

	/**
	 * The days the trends are drawn over, oldest first, ending on today.
	 *
	 * @returns {Promise<Object[]>}
	 */
	async history() {
		const rows = await this.db.all('SELECT * FROM stats_daily ORDER BY day DESC LIMIT ?', trendDays)
		const history = rows.reverse()
		const volume = await this.db.all(`SELECT day, SUM(invocations) AS invocations FROM stats_commands
			WHERE day >= ? GROUP BY day`, history[0].day)
		const active = await this.db.all(`SELECT day, COUNT(DISTINCT guildID) AS guilds FROM stats_guild_usage
			WHERE day >= ? GROUP BY day`, history[0].day)
		const invocations = new Map(volume.map(row => [row.day, row.invocations]))
		const guilds = new Map(active.map(row => [row.day, row.guilds]))

		for (const row of history) {
			row.invocations = invocations.get(row.day) ?? 0
			row.activeGuilds = guilds.get(row.day) ?? 0
		}

		return history
	}

	/**
	 * The share a part holds of a total.
	 *
	 * @param {number} part - part
	 * @param {number} total - total
	 *
	 * @returns {string}
	 */
	share(part, total) {
		return total ? `${Math.round((part / total) * 100)}%` : '0%'
	}

	/**
	 * The change a value carries since a day, or a note that the day is missing.
	 *
	 * @param {number} value - value
	 * @param {number|undefined} previous - previous
	 *
	 * @returns {string}
	 */
	delta(value, previous) {
		if (previous === undefined) {
			return '_first week_'
		}

		const change = value - previous
		const sign = change > 0 ? '+' : change < 0 ? '−' : '±'

		return `_${sign}${Math.abs(change).toLocaleString('en-US')} in 7d_`
	}

	/**
	 * The name an interaction is counted under.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {string}
	 */
	commandName(interaction) {
		if (!interaction.isChatInputCommand()) {
			return interaction.commandName
		}

		const subcommand = interaction.options.getSubcommand(false)

		return subcommand ? `/${interaction.commandName} ${subcommand}` : `/${interaction.commandName}`
	}

	/**
	 * The day an offset lands on, in UTC.
	 *
	 * @param {number} [offset] - offset
	 *
	 * @returns {string}
	 */
	day(offset = 0) {
		const date = new Date()
		date.setUTCDate(date.getUTCDate() + offset)

		return date.toISOString().slice(0, 10)
	}

	/**
	 * The text wrapped in a code block.
	 *
	 * @param {string} text - text
	 *
	 * @returns {string}
	 */
	block(text) {
		return text ? `\`\`\`\n${text}\n\`\`\`` : '_Nothing yet._'
	}

	/**
	 * The name a server is drawn with.
	 *
	 * @param {string} name - name
	 * @param {number} [length] - length
	 *
	 * @returns {string}
	 */
	name(name, length = nameLength) {
		return label(name.replace(/^https?:\/\//i, ''), length)
	}
}

module.exports = {
	StatsManager: StatsManager
}
