const axios = require('axios')
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto')
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, GuildVerificationLevel, Interaction, LabelBuilder, MessageFlags, ModalBuilder, PermissionsBitField, TextInputBuilder, TextInputStyle, UserFlags, escapeMarkdown } = require('discord.js')
const { Database } = require('./database')

/** The app a member verifies for. */
const appName = process.env['APP_NAME']

/** The color a report is embedded with. */
const appColor = parseInt(process.env['APP_COLOR'].replace('#', ''), 16)

/** The user an unrecognized control is reported to. */
const ownerID = process.env['OWNER_ID']

/** The page a member solves the challenge on. */
const challengeURL = process.env['VERIFICATION_URL']

/** The endpoint the solved challenges are read from. */
const solvedURL = process.env['VERIFICATION_SOLVED_URL']

/** The secret a challenge is signed with. */
const secret = process.env['VERIFICATION_SECRET']

/** The seconds between two reads of the solved challenges. */
const pollSeconds = 5

/** The minutes between two sweeps of the members who never verified. */
const sweepMinutes = 15

/** The messages the verification panel is looked for in. */
const panelLimit = 50

/** The hours an invite sent to a removed member lasts. */
const inviteHours = 24

/** The badges an account can no longer be given, or had to be paid for. */
const costlyBadges = [
	{ flag: UserFlags.PremiumEarlySupporter, name: 'an early supporter badge' },
	{ flag: UserFlags.VerifiedDeveloper, name: 'an early verified developer badge' },
	{ flag: UserFlags.CertifiedModerator, name: 'a certified moderator badge' },
	{ flag: UserFlags.BugHunterLevel2, name: 'a golden bug hunter badge' },
	{ flag: UserFlags.BugHunterLevel1, name: 'a bug hunter badge' },
	{ flag: UserFlags.Staff, name: 'a Discord staff badge' },
	{ flag: UserFlags.Partner, name: 'a Discord partner badge' }
]

/** The flags Discord marks an abusive account with. */
const abusiveFlags = [
	UserFlags.Spammer
]

/** The permissions the verification channel needs. */
const requiredPermissions = [
	PermissionsBitField.Flags.ViewChannel,
	PermissionsBitField.Flags.SendMessages,
	PermissionsBitField.Flags.ReadMessageHistory
]

/** The range each setting is written within. */
const bounds = {
	challengeMinutes: { min: 1, max: 1440 },
	kickHours: { min: 1, max: 168 },
	establishedDays: { min: 0, max: 3650 },
	raidJoins: { min: 2, max: 100 },
	raidWindowSeconds: { min: 5, max: 3600 },
	raidCooldownMinutes: { min: 1, max: 1440 }
}

/** The prefix on every verification control’s custom id. */
const componentPrefix = 'verification_'

class VerificationManager {
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
	 * @param {NodeJS.Timeout} pollTimer - poll timer
	 */
	pollTimer

	/**
	 * @param {NodeJS.Timeout} sweepTimer - sweep timer
	 */
	sweepTimer

	/**
	 * @param {Map<string, number[]>} joins - joins
	 */
	joins = new Map()

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
	 * Starts holding every new member until they verify.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {
		if (!this.isWatchingJoins()) {
			console.log('🔒 Verification is parked. It needs the Server Members Intent.')
			return
		}

		if (!this.isHosted()) {
			console.log('🔒 Verification is off. Set VERIFICATION_URL, VERIFICATION_SOLVED_URL and VERIFICATION_SECRET to turn it on.')
			return
		}

		if (!this.client.isReady()) {
			await new Promise(resolve => this.client.once('clientReady', resolve))
		}

		this.client.on('guildMemberAdd', member => {
			this.handleJoin(member)
				.catch(error => console.error(error))
		})

		for (const config of this.configs()) {
			await this.panel(config)
		}

		this.pollTimer = setInterval(() => {
			this.poll()
				.catch(error => console.error(error))
		}, pollSeconds * 1000)

		this.sweepTimer = setInterval(() => {
			this.sweep()
				.catch(error => console.error(error))
		}, sweepMinutes * 60 * 1000)

		await this.sweep()

		const configured = this.db.get('SELECT COUNT(*) AS servers FROM verification_settings WHERE isEnabled = 1')

		console.log(`🔒 Verifying new members in ${configured.servers} servers. Run /verification set to add one.`)
	}

	/** Stops holding new members. */
	stop() {
		clearInterval(this.pollTimer)
		clearInterval(this.sweepTimer)
		this.pollTimer = null
		this.sweepTimer = null
	}

	/**
	 * Whether a page is there for members to verify on.
	 *
	 * @returns {boolean} isHosted - is hosted
	 */
	isHosted() {
		return !!(challengeURL && solvedURL && secret)
	}

	/**
	 * Whether the client is told about the members who join.
	 *
	 * @returns {boolean} isWatchingJoins - is watching joins
	 */
	isWatchingJoins() {
		return this.client.options.intents.has(GatewayIntentBits.GuildMembers)
	}

	// MARK: - Settings
	/**
	 * A server’s verification, or null when it has none.
	 *
	 * @param {?string} guildID - guild id
	 *
	 * @returns {?Object} config - config
	 */
	config(guildID) {
		return this.db.get('SELECT * FROM verification_settings WHERE guildID = ?', guildID) ?? null
	}

	/**
	 * Every server that verifies its new members.
	 *
	 * @returns {Object[]} configs - configs
	 */
	configs() {
		return this.db.all('SELECT * FROM verification_settings WHERE isEnabled = 1')
	}

	/**
	 * Sets the channel members verify in, and the role they’re given.
	 *
	 * @param {string} guildID - guild id
	 * @param {string} channelID - channel id
	 * @param {string} roleID - role id
	 * @param {?string} logChannelID - log channel id
	 * @param {?string} inviteURL - invite url
	 *
	 * @returns {Object} config - config
	 */
	choose(guildID, channelID, roleID, logChannelID, inviteURL) {
		this.db.run(`INSERT INTO verification_settings (guildID, channelID, roleID, logChannelID, inviteURL, isEnabled)
			VALUES (?, ?, ?, ?, ?, 1)
			ON CONFLICT (guildID) DO UPDATE SET channelID = excluded.channelID, roleID = excluded.roleID, logChannelID = excluded.logChannelID, inviteURL = excluded.inviteURL, isEnabled = 1`,
		guildID,
		channelID,
		roleID,
		logChannelID,
		inviteURL)

		return this.config(guildID)
	}

	// MARK: - Joining
	/**
	 * Reads a new member and decides whether they pass, verify or leave.
	 *
	 * @param {GuildMember} member - member
	 *
	 * @returns {Promise<void>}
	 */
	async handleJoin(member) {
		const config = this.config(member.guild.id)

		if (member.user.bot || !config?.isEnabled) {
			return
		}

		this.db.run(`INSERT INTO verifications (guildID, userID, joinedAt)
			VALUES (?, ?, ?)
			ON CONFLICT (guildID, userID) DO UPDATE SET joinedAt = excluded.joinedAt, verifiedAt = NULL, method = NULL, nonce = NULL, expiresAt = NULL, attempts = 0`,
		member.guild.id,
		member.id,
		new Date().toISOString())

		const raiding = await this.noteJoin(member.guild, config)

		if (this.isAbusive(member.user)) {
			return await this.remove(member, config, 'Discord flags this account for spam.')
		}

		if (raiding) {
			return await this.record(config, member.id, 'held', 'joined during a raid')
		}

		const user = await this.client.users.fetch(member.id, { force: true })
			.catch(() => member.user)

		if (this.isAbusive(user)) {
			return await this.remove(member, config, 'Discord flags this account for spam.')
		}

		if (this.isEstablished(user, member, config)) {
			return await this.grant(member, config, 'established')
		}

		await this.record(config, member.id, 'joined', `account is ${this.ageText(user)} old`)
	}

	/**
	 * Whether Discord marks an account as abusive.
	 *
	 * @param {User} user - user
	 *
	 * @returns {boolean} isAbusive - is abusive
	 */
	isAbusive(user) {
		return abusiveFlags.some(flag => user.flags?.has(flag))
	}

	/**
	 * Whether an account is old enough, and costly enough, to pass without a
	 * challenge.
	 *
	 * @param {User} user - user
	 * @param {GuildMember} member - member
	 * @param {Object} config - config
	 *
	 * @returns {boolean} isEstablished - is established
	 */
	isEstablished(user, member, config) {
		if (!config.passesEstablished) {
			return false
		}

		const age = Date.now() - user.createdTimestamp

		if (age < config.establishedDays * 24 * 60 * 60 * 1000) {
			return false
		}

		return !!this.costliness(user, member)
	}

	/**
	 * What an account carries that had to be paid for or can no longer be earned.
	 *
	 * @param {User} user - user
	 * @param {?GuildMember} member - member
	 *
	 * @returns {?string} costliness - costliness
	 */
	costliness(user, member) {
		const badge = costlyBadges.find(badge => user.flags?.has(badge.flag))

		if (badge) {
			return badge.name
		}

		if (user.banner) {
			return 'a profile banner'
		}

		if (user.avatarDecorationData) {
			return 'an avatar decoration'
		}

		if (user.collectibles?.nameplate) {
			return 'a nameplate'
		}

		if (user.avatar?.startsWith('a_')) {
			return 'an animated avatar'
		}

		if (member?.premiumSinceTimestamp) {
			return 'a server boost'
		}

		return null
	}

	/**
	 * The age of an account, written for a report.
	 *
	 * @param {User} user - user
	 *
	 * @returns {string} age - age
	 */
	ageText(user) {
		const days = Math.floor((Date.now() - user.createdTimestamp) / (24 * 60 * 60 * 1000))

		if (days < 1) {
			return 'less than a day'
		}

		if (days < 60) {
			return `${days} ${days === 1 ? 'day' : 'days'}`
		}

		const months = Math.floor(days / 30)

		return months < 24 ? `${months} months` : `${Math.floor(days / 365)} years`
	}

	// MARK: - Raids
	/**
	 * Counts a join, starts a raid once too many land at once, and answers
	 * whether one is going on.
	 *
	 * @param {Guild} guild - guild
	 * @param {Object} config - config
	 *
	 * @returns {Promise<boolean>} isRaiding - is raiding
	 */
	async noteJoin(guild, config) {
		const window = Date.now() - config.raidWindowSeconds * 1000
		const counted = (this.joins.get(guild.id) ?? []).filter(join => join > window)

		counted.push(Date.now())
		this.joins.set(guild.id, counted)

		if (counted.length < config.raidJoins) {
			return this.isRaiding(config)
		}

		await this.startRaid(guild, config, counted.length)

		return true
	}

	/**
	 * Whether a raid is going on.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {boolean} isRaiding - is raiding
	 */
	isRaiding(config) {
		return !!config.raidUntil && new Date(config.raidUntil).getTime() > Date.now()
	}

	/**
	 * Raises the server to phone verification and holds every join.
	 *
	 * @param {Guild} guild - guild
	 * @param {Object} config - config
	 * @param {number} joins - joins
	 *
	 * @returns {Promise<void>}
	 */
	async startRaid(guild, config, joins) {
		const wasRaiding = this.isRaiding(config)
		const until = new Date(Date.now() + config.raidCooldownMinutes * 60 * 1000).toISOString()
		const level = config.raidLevel ?? guild.verificationLevel

		this.db.run('UPDATE verification_settings SET raidUntil = ?, raidLevel = ? WHERE guildID = ?', until, level, guild.id)

		config.raidUntil = until
		config.raidLevel = level

		if (wasRaiding) {
			return
		}

		await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'A raid is going on.')
			.catch(error => console.error(error))

		await this.record(config, null, 'raid_started', `${joins} joins in ${config.raidWindowSeconds}s`)

		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('Raid')
			.setDescription(`${joins} accounts joined in ${config.raidWindowSeconds} seconds. The server now asks for a verified phone number, and no account passes without a challenge until this is lifted.`)
			.setFooter({ text: `Lifting on its own ${config.raidCooldownMinutes}m after the last join` })

		await this.report(config, {
			embeds: [embed],
			components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
				.setCustomId(`${componentPrefix}lift`)
				.setLabel('Lift now')
				.setStyle(ButtonStyle.Secondary))]
		})
	}

	/**
	 * Lowers the server back to the level it was raised from.
	 *
	 * @param {Guild} guild - guild
	 * @param {Object} config - config
	 *
	 * @returns {Promise<void>}
	 */
	async endRaid(guild, config) {
		this.joins.delete(guild.id)

		if (config.raidLevel !== null && config.raidLevel !== undefined) {
			await guild.setVerificationLevel(config.raidLevel, 'The raid is over.')
				.catch(error => console.error(error))
		}

		this.db.run('UPDATE verification_settings SET raidUntil = NULL, raidLevel = NULL WHERE guildID = ?', guild.id)

		config.raidUntil = null
		config.raidLevel = null

		await this.record(config, null, 'raid_lifted', null)
	}

	// MARK: - Challenge
	/**
	 * The message a member starts their challenge from.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<?Message>} message - message
	 */
	async panel(config) {
		const channel = await this.channel(config.channelID)

		if (!channel) {
			console.error(`Members can’t verify in the server ${config.guildID}. I need ${requiredPermissions.map(permission => new PermissionsBitField(permission).toArray()[0]).join(', ')} in the channel ${config.channelID}.`)
			return null
		}

		const payload = this.panelPayload(config)
		const messages = await channel.messages.fetch({ limit: panelLimit })
			.catch(() => null)
		const posted = messages?.find(message => message.author.id === this.client.user.id
			&& message.components.length
			&& JSON.stringify(message.components).includes(`${componentPrefix}verify`))

		return posted
			? await posted.edit(payload).catch(error => console.error(error))
			: await channel.send(payload).catch(error => console.error(error))
	}

	/**
	 * The panel a member starts their challenge from.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Object} payload - payload
	 */
	panelPayload(config) {
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(`Welcome to ${appName}`)
			.setDescription([
				'Press **Verify** below to open the rest of the server.',
				'',
				`It takes a few seconds: the button opens a page on ${appName}, you solve one challenge, and you land right back here with everything unlocked.`
			].join('\n'))
			.setFooter({ text: `Members who don’t verify within ${config.kickHours}h are removed, and are welcome to come back` })

		return {
			embeds: [embed],
			components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
				.setCustomId(`${componentPrefix}verify`)
				.setLabel('Verify')
				.setStyle(ButtonStyle.Success))]
		}
	}

	/**
	 * Opens a challenge for the member who pressed Verify.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Object} config - config
	 *
	 * @returns {Promise<*>}
	 */
	async challenge(interaction, config) {
		const member = interaction.member

		if (member.roles.cache.has(config.roleID)) {
			return await interaction.reply({
				content: 'You’re already verified. Welcome in.',
				flags: MessageFlags.Ephemeral
			})
		}

		const nonce = randomBytes(16).toString('base64url')
		const expiresAt = new Date(Date.now() + config.challengeMinutes * 60 * 1000)

		this.db.run(`INSERT INTO verifications (guildID, userID, joinedAt, nonce, expiresAt, attempts)
			VALUES (?, ?, ?, ?, ?, 1)
			ON CONFLICT (guildID, userID) DO UPDATE SET nonce = excluded.nonce, expiresAt = excluded.expiresAt, attempts = attempts + 1`,
		interaction.guildId,
		member.id,
		member.joinedAt?.toISOString() ?? new Date().toISOString(),
		nonce,
		expiresAt.toISOString())

		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('One step left')
			.setDescription(`Open the page below and solve the challenge. This link is yours alone and stops working <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.`)

		return await interaction.reply({
			embeds: [embed],
			components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
				.setURL(this.link(interaction.guildId, member.id, nonce, expiresAt))
				.setLabel(`Verify on ${appName}`)
				.setStyle(ButtonStyle.Link))],
			flags: MessageFlags.Ephemeral
		})
	}

	/**
	 * The link a member solves their challenge on.
	 *
	 * @param {string} guildID - guild id
	 * @param {string} userID - user id
	 * @param {string} nonce - nonce
	 * @param {Date} expiresAt - expires at
	 *
	 * @returns {string} link - link
	 */
	link(guildID, userID, nonce, expiresAt) {
		const claim = Buffer.from([guildID, userID, nonce, Math.floor(expiresAt.getTime() / 1000)].join(':')).toString('base64url')
		return `${challengeURL}?t=${claim}.${this.sign(claim)}`
	}

	/**
	 * The signature a claim carries.
	 *
	 * @param {string} claim - claim
	 *
	 * @returns {string} signature - signature
	 */
	sign(claim) {
		return createHmac('sha256', secret).update(claim).digest('base64url')
	}

	/**
	 * Reads the challenges that were solved and lets those members in.
	 *
	 * @returns {Promise<void>}
	 */
	async poll() {
		const pending = this.db.all(`SELECT * FROM verifications
			WHERE nonce IS NOT NULL AND verifiedAt IS NULL AND expiresAt > ?`,
		new Date().toISOString())

		if (!pending.length) {
			return
		}

		const solved = await this.solved(pending.map(row => row.nonce))

		for (const row of pending.filter(row => solved.has(row.nonce))) {
			const config = this.config(row.guildID)
			const guild = await this.client.guilds.fetch(row.guildID)
				.catch(() => null)
			const member = await guild?.members.fetch(row.userID)
				.catch(() => null)

			if (config && member) {
				await this.grant(member, config, 'challenge')
			}
		}
	}

	/**
	 * The nonces whose challenge was solved.
	 *
	 * @param {string[]} nonces - nonces
	 *
	 * @returns {Promise<Set<string>>} solved - solved
	 */
	async solved(nonces) {
		const response = await axios.get(solvedURL, {
			params: { nonces: nonces.join(',') },
			headers: {
				'User-Agent': process.env['KUROZORA_USER_AGENT'],
				'X-API-Key': process.env['KUROZORA_API_KEY']
			},
			timeout: pollSeconds * 1000
		}).catch(error => {
			console.error(`Couldn’t read the solved challenges: ${error.message}`)
			return null
		})

		const solved = response?.data?.data?.solved ?? response?.data?.solved ?? []

		return new Set(solved.filter(nonce => nonces.some(pending => this.matches(pending, nonce))))
	}

	/**
	 * Whether two nonces are the same.
	 *
	 * @param {string} pending - pending
	 * @param {string} solved - solved
	 *
	 * @returns {boolean} matches - matches
	 */
	matches(pending, solved) {
		const left = Buffer.from(String(pending))
		const right = Buffer.from(String(solved))

		return left.length === right.length && timingSafeEqual(left, right)
	}

	// MARK: - Membership
	/**
	 * Lets a member into the server.
	 *
	 * @param {GuildMember} member - member
	 * @param {Object} config - config
	 * @param {string} method - method
	 * @param {boolean} [isQuiet] - is quiet
	 *
	 * @returns {Promise<void>}
	 */
	async grant(member, config, method, isQuiet = false) {
		const role = await member.guild.roles.fetch(config.roleID)
			.catch(() => null)

		if (!role) {
			console.error(`Members can’t be verified in the server ${config.guildID}. The role ${config.roleID} is gone.`)
			return
		}

		await member.roles.add(role, `Verified — ${method}.`)
			.catch(error => console.error(error))

		this.db.run(`INSERT INTO verifications (guildID, userID, joinedAt, verifiedAt, method)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (guildID, userID) DO UPDATE SET verifiedAt = excluded.verifiedAt, method = excluded.method, nonce = NULL, expiresAt = NULL`,
		member.guild.id,
		member.id,
		member.joinedAt?.toISOString() ?? new Date().toISOString(),
		new Date().toISOString(),
		method)

		if (!isQuiet) {
			await this.record(config, member.id, 'verified', method)
		}
	}

	/**
	 * Tells a member why they are leaving, sends them a way back, then removes them.
	 *
	 * @param {GuildMember} member - member
	 * @param {Object} config - config
	 * @param {string} reason - reason
	 *
	 * @returns {Promise<void>}
	 */
	async remove(member, config, reason) {
		const invite = await this.invite(member.guild, config)
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(`You were removed from ${member.guild.name}`)
			.setDescription([
				reason,
				'',
				invite
					? `If this is a mistake, the door is open — rejoin with the link below and verify.\n${invite}`
					: 'If this is a mistake, ask for a new invite and try again.'
			].join('\n'))

		await member.send({ embeds: [embed] })
			.catch(() => this.record(config, member.id, 'undelivered', 'their DMs are closed'))

		await member.kick(reason)
			.catch(error => console.error(error))

		await this.record(config, member.id, 'removed', reason)
	}

	/**
	 * The invite a removed member is sent, or null when none can be made.
	 *
	 * @param {Guild} guild - guild
	 * @param {Object} config - config
	 *
	 * @returns {Promise<?string>} invite - invite
	 */
	async invite(guild, config) {
		if (config.inviteURL) {
			return config.inviteURL
		}

		const channel = await this.channel(config.channelID)
		const invite = await channel?.createInvite({
			maxAge: inviteHours * 60 * 60,
			maxUses: 1,
			unique: true,
			reason: 'A removed member was given a way back.'
		}).catch(() => null)

		return invite?.url ?? null
	}

	/**
	 * Removes the members who never verified, and lifts the raids that are over.
	 *
	 * @returns {Promise<void>}
	 */
	async sweep() {
		for (const config of this.configs()) {
			const since = new Date(Date.now() - config.kickHours * 60 * 60 * 1000).toISOString()
			const overdue = this.db.all(`SELECT * FROM verifications
				WHERE guildID = ? AND verifiedAt IS NULL AND joinedAt <= ?`,
			config.guildID,
			since)
			const guild = await this.client.guilds.fetch(config.guildID)
				.catch(() => null)

			if (!guild) {
				continue
			}

			for (const row of overdue) {
				const member = await guild.members.fetch(row.userID)
					.catch(() => null)

				if (!member) {
					this.db.run('DELETE FROM verifications WHERE guildID = ? AND userID = ?', row.guildID, row.userID)
					continue
				}

				if (member.roles.cache.has(config.roleID)) {
					await this.grant(member, config, 'role')
					continue
				}

				await this.remove(member, config, `You didn’t verify within ${config.kickHours} hours of joining.`)
			}

			if (config.raidUntil && !this.isRaiding(config)) {
				await this.endRaid(guild, config)
			}
		}
	}

	/**
	 * Gives the role to every member who was here before verification was.
	 *
	 * @param {Guild} guild - guild
	 * @param {Object} config - config
	 *
	 * @returns {Promise<number>} granted - granted
	 */
	async backfill(guild, config) {
		const members = await guild.members.fetch()
		const missing = members.filter(member => !member.user.bot && !member.roles.cache.has(config.roleID))
		let granted = 0

		for (const member of missing.values()) {
			await this.grant(member, config, 'backfill', true)
			granted++
		}

		await this.record(config, null, 'backfilled', `${granted} members`)

		return granted
	}

	// MARK: - Reporting
	/**
	 * Records a verification decision.
	 *
	 * @param {Object} config - config
	 * @param {?string} userID - user id
	 * @param {string} event - event
	 * @param {?string} detail - detail
	 *
	 * @returns {Promise<void>}
	 */
	async record(config, userID, event, detail) {
		this.db.run('INSERT INTO verification_events (guildID, userID, event, detail, createdAt) VALUES (?, ?, ?, ?, ?)',
			config.guildID,
			userID,
			event,
			detail,
			new Date().toISOString())

		if (event === 'joined' || event === 'undelivered') {
			return
		}

		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(this.headline(event))
			.setDescription([userID ? `<@${userID}>` : null, detail].filter(Boolean).join(' — '))
			.setTimestamp()

		await this.report(config, { embeds: [embed] })
	}

	/**
	 * The headline an event is reported under.
	 *
	 * @param {string} event - event
	 *
	 * @returns {string} headline - headline
	 */
	headline(event) {
		switch (event) {
			case 'verified': return 'Verified'
			case 'removed': return 'Removed'
			case 'held': return 'Held back'
			case 'backfilled': return 'Backfilled'
			case 'raid_started': return 'Raid'
			case 'raid_lifted': return 'Raid lifted'
			default: return 'Verification'
		}
	}

	/**
	 * Writes to the channel verifications are reported in.
	 *
	 * @param {Object} config - config
	 * @param {Object} payload - payload
	 *
	 * @returns {Promise<void>}
	 */
	async report(config, payload) {
		const channel = await this.channel(config.logChannelID)

		await channel?.send(payload)
			.catch(error => console.error(error))
	}

	/**
	 * A server’s verification, and the controls it is changed with.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {Promise<Object>} payload - payload
	 */
	async configPayload(config) {
		const channel = await this.channel(config.channelID)
		const verified = this.db.get('SELECT COUNT(*) AS members FROM verifications WHERE guildID = ? AND verifiedAt IS NOT NULL', config.guildID)
		const waiting = this.db.get('SELECT COUNT(*) AS members FROM verifications WHERE guildID = ? AND verifiedAt IS NULL', config.guildID)
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle('Verification')
			.addFields({
				name: 'Channel',
				value: channel ? `<#${config.channelID}>` : `<#${config.channelID}> — unreachable`,
				inline: true
			}, {
				name: 'Role',
				value: `<@&${config.roleID}>`,
				inline: true
			}, {
				name: 'State',
				value: config.isEnabled ? 'On' : 'Off',
				inline: true
			}, {
				name: 'Reported in',
				value: config.logChannelID ? `<#${config.logChannelID}>` : 'Nowhere',
				inline: true
			}, {
				name: 'Verified',
				value: `${verified.members}`,
				inline: true
			}, {
				name: 'Waiting',
				value: `${waiting.members}`,
				inline: true
			}, {
				name: 'Passing on their own',
				value: config.passesEstablished
					? `Accounts older than ${config.establishedDays} days carrying something bought or no longer obtainable`
					: 'Nobody — everyone solves a challenge',
				inline: false
			}, {
				name: 'Raid',
				value: this.isRaiding(config)
					? `On until <t:${Math.floor(new Date(config.raidUntil).getTime() / 1000)}:R>`
					: `${config.raidJoins} joins in ${config.raidWindowSeconds}s, lifting ${config.raidCooldownMinutes}m after the last one`,
				inline: false
			})
			.setFooter({ text: [
				`Challenge open for ${config.challengeMinutes}m`,
				`Removed after ${config.kickHours}h`
			].join(' · ') })

		return { embeds: [embed], components: [this.controls(config)] }
	}

	/**
	 * The controls a server’s verification is changed with.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {ActionRowBuilder} controls - controls
	 */
	controls(config) {
		return new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}toggle`)
				.setLabel(config.isEnabled ? 'Turn off' : 'Turn on')
				.setStyle(config.isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}settings`)
				.setLabel('Settings…')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}established`)
				.setLabel(config.passesEstablished ? 'Challenge everyone' : 'Pass established')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}post`)
				.setLabel('Put panel up')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(`${componentPrefix}lift`)
				.setLabel('Lift raid')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(!this.isRaiding(config))
		)
	}

	/**
	 * The modal a server’s settings are written in.
	 *
	 * @param {Object} config - config
	 *
	 * @returns {ModalBuilder} modal - modal
	 */
	settingsModal(config) {
		return new ModalBuilder()
			.setCustomId(`${componentPrefix}modal`)
			.setTitle('Verification')
			.addLabelComponents(
				new LabelBuilder()
					.setLabel('Challenge open for')
					.setDescription(`Minutes. ${bounds.challengeMinutes.min}–${bounds.challengeMinutes.max}.`)
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('challengeMinutes')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(4)
						.setValue(`${config.challengeMinutes}`)),
				new LabelBuilder()
					.setLabel('Removed after')
					.setDescription(`Hours a member is given to verify. ${bounds.kickHours.min}–${bounds.kickHours.max}.`)
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('kickHours')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(3)
						.setValue(`${config.kickHours}`)),
				new LabelBuilder()
					.setLabel('Established after')
					.setDescription(`Days an account is registered for before it may pass on its own. ${bounds.establishedDays.min}–${bounds.establishedDays.max}.`)
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('establishedDays')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(4)
						.setValue(`${config.establishedDays}`)),
				new LabelBuilder()
					.setLabel('Raid starts at')
					.setDescription('Joins per seconds, such as 10/60.')
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('raid')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(9)
						.setValue(`${config.raidJoins}/${config.raidWindowSeconds}`)),
				new LabelBuilder()
					.setLabel('Raid lifts after')
					.setDescription(`Minutes without a join. ${bounds.raidCooldownMinutes.min}–${bounds.raidCooldownMinutes.max}.`)
					.setTextInputComponent(new TextInputBuilder()
						.setCustomId('raidCooldownMinutes')
						.setStyle(TextInputStyle.Short)
						.setMaxLength(4)
						.setValue(`${config.raidCooldownMinutes}`))
			)
	}

	/**
	 * Saves the settings a member wrote.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {Object} config - config
	 *
	 * @returns {Promise<*>}
	 */
	async submitSettings(interaction, config) {
		const [joins, window] = interaction.fields.getTextInputValue('raid').split('/')
		const written = {
			challengeMinutes: interaction.fields.getTextInputValue('challengeMinutes'),
			kickHours: interaction.fields.getTextInputValue('kickHours'),
			establishedDays: interaction.fields.getTextInputValue('establishedDays'),
			raidJoins: joins,
			raidWindowSeconds: window,
			raidCooldownMinutes: interaction.fields.getTextInputValue('raidCooldownMinutes')
		}
		const settings = {}

		for (const [name, value] of Object.entries(written)) {
			const number = Number.parseInt(String(value ?? '').trim(), 10)
			const bound = bounds[name]

			if (!Number.isInteger(number) || number < bound.min || number > bound.max) {
				return await interaction.reply({
					content: `**${name}** is written as a whole number from ${bound.min} to ${bound.max}.`,
					flags: MessageFlags.Ephemeral
				})
			}

			settings[name] = number
		}

		this.db.run(`UPDATE verification_settings SET challengeMinutes = ?, kickHours = ?, establishedDays = ?, raidJoins = ?, raidWindowSeconds = ?, raidCooldownMinutes = ?
			WHERE guildID = ?`,
		settings.challengeMinutes,
		settings.kickHours,
		settings.establishedDays,
		settings.raidJoins,
		settings.raidWindowSeconds,
		settings.raidCooldownMinutes,
		config.guildID)

		await this.panel(this.config(config.guildID))

		return await this.refresh(interaction)
	}

	/**
	 * A member’s verification, written for a report.
	 *
	 * @param {Interaction} interaction - interaction
	 * @param {User} user - user
	 *
	 * @returns {Promise<*>}
	 */
	async status(interaction, user) {
		const row = this.db.get('SELECT * FROM verifications WHERE guildID = ? AND userID = ?', interaction.guildId, user.id)
		const fetched = await this.client.users.fetch(user.id, { force: true })
			.catch(() => user)
		const member = await interaction.guild.members.fetch(user.id)
			.catch(() => null)
		const embed = new EmbedBuilder()
			.setColor(appColor)
			.setTitle(escapeMarkdown(fetched.username))
			.setThumbnail(fetched.displayAvatarURL())
			.addFields({
				name: 'Account age',
				value: this.ageText(fetched),
				inline: true
			}, {
				name: 'State',
				value: row?.verifiedAt ? `Verified <t:${Math.floor(new Date(row.verifiedAt).getTime() / 1000)}:R>` : 'Not verified',
				inline: true
			}, {
				name: 'Passed by',
				value: row?.method ?? '—',
				inline: true
			}, {
				name: 'Carries',
				value: this.costliness(fetched, member) ?? 'nothing that had to be paid for',
				inline: true
			}, {
				name: 'Flagged by Discord',
				value: this.isAbusive(fetched) ? 'Yes — spam' : 'No',
				inline: true
			}, {
				name: 'Challenges opened',
				value: `${row?.attempts ?? 0}`,
				inline: true
			})

		return await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral
		})
	}

	// MARK: - Controls
	/**
	 * Handles the selected control.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handleComponent(interaction) {
		const config = this.config(interaction.guildId)

		if (!config) {
			return await interaction.reply({
				content: 'Verification isn’t set up here. Run `/verification set` to turn it on.',
				flags: MessageFlags.Ephemeral
			})
		}

		if (interaction.isModalSubmit()) {
			return await this.submitSettings(interaction, config)
		}

		const action = interaction.customId.slice(componentPrefix.length)

		if (action === 'verify') {
			return await this.challenge(interaction, config)
		}

		if (action === 'settings') {
			return await interaction.showModal(this.settingsModal(config))
				.catch(error => console.error(error))
		}

		switch (action) {
			case 'toggle': {
				this.db.run('UPDATE verification_settings SET isEnabled = ? WHERE guildID = ?', config.isEnabled ? 0 : 1, config.guildID)
				break
			}
			case 'established': {
				this.db.run('UPDATE verification_settings SET passesEstablished = ? WHERE guildID = ?', config.passesEstablished ? 0 : 1, config.guildID)
				break
			}
			case 'post': {
				await this.panel(config)
				break
			}
			case 'lift': {
				await this.endRaid(interaction.guild, config)
				break
			}
			default: {
				return await interaction.reply({
					content: `This control is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
					flags: MessageFlags.Ephemeral
				})
			}
		}

		return await this.refresh(interaction)
	}

	/**
	 * Writes the report the control was pressed on again.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async refresh(interaction) {
		await interaction.deferUpdate()
			.catch(error => console.error(error))

		return await interaction.editReply(await this.configPayload(this.config(interaction.guildId)))
			.catch(error => console.error(error))
	}

	/**
	 * Handles the selected command.
	 *
	 * @param {Interaction} interaction - interaction
	 *
	 * @returns {Promise<*>}
	 */
	async handle(interaction) {
		if (!this.isWatchingJoins()) {
			return await interaction.reply({
				content: 'Verification is parked. It needs the Server Members Intent.',
				flags: MessageFlags.Ephemeral
			})
		}

		if (!this.isHosted()) {
			return await interaction.reply({
				content: 'Verification is off. This instance has no `VERIFICATION_URL`, `VERIFICATION_SOLVED_URL` or `VERIFICATION_SECRET` set.',
				flags: MessageFlags.Ephemeral
			})
		}

		const subcommand = interaction.options.getSubcommand()

		if (subcommand === 'set') {
			const config = this.choose(interaction.guildId,
				interaction.options.getChannel('channel').id,
				interaction.options.getRole('role').id,
				interaction.options.getChannel('log')?.id ?? null,
				interaction.options.getString('invite') ?? null)

			await this.panel(config)

			return await interaction.reply({
				...await this.configPayload(config),
				flags: MessageFlags.Ephemeral
			})
		}

		const config = this.config(interaction.guildId)

		if (!config) {
			return await interaction.reply({
				content: 'Verification isn’t set up here. Run `/verification set` to turn it on.',
				flags: MessageFlags.Ephemeral
			})
		}

		switch (subcommand) {
			case 'off': {
				this.db.run('UPDATE verification_settings SET isEnabled = 0 WHERE guildID = ?', config.guildID)

				return await interaction.reply({
					content: 'New members walk straight in again.',
					flags: MessageFlags.Ephemeral
				})
			}
			case 'status': {
				return await interaction.reply({
					...await this.configPayload(config),
					flags: MessageFlags.Ephemeral
				})
			}
			case 'panel': {
				await this.panel(config)

				return await interaction.reply({
					content: `The panel is up in <#${config.channelID}>.`,
					flags: MessageFlags.Ephemeral
				})
			}
			case 'member': {
				return await this.status(interaction, interaction.options.getUser('member'))
			}
			case 'approve': {
				const member = await interaction.guild.members.fetch(interaction.options.getUser('member').id)
					.catch(() => null)

				if (!member) {
					return await interaction.reply({
						content: 'That member isn’t here.',
						flags: MessageFlags.Ephemeral
					})
				}

				await this.grant(member, config, 'approved')

				return await interaction.reply({
					content: `<@${member.id}> is verified.`,
					flags: MessageFlags.Ephemeral
				})
			}
			case 'backfill': {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral })

				const granted = await this.backfill(interaction.guild, config)

				return await interaction.editReply(`${granted} ${granted === 1 ? 'member is' : 'members are'} verified.`)
			}
			case 'raid': {
				if (interaction.options.getBoolean('on')) {
					await this.startRaid(interaction.guild, config, config.raidJoins)

					return await interaction.reply({
						content: 'Raid mode is on. The server asks for a verified phone number, and nobody passes without a challenge.',
						flags: MessageFlags.Ephemeral
					})
				}

				await this.endRaid(interaction.guild, config)

				return await interaction.reply({
					content: 'Raid mode is off.',
					flags: MessageFlags.Ephemeral
				})
			}
			default: {
				return await interaction.reply({
					content: `This command is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
					flags: MessageFlags.Ephemeral
				})
			}
		}
	}

	// MARK: - Helpers
	/**
	 * A channel verification writes in, or null when it is unusable.
	 *
	 * @param {?string} id - id
	 *
	 * @returns {Promise<?TextChannel>} channel - channel
	 */
	async channel(id) {
		if (!id) {
			return null
		}

		const channel = await this.client.channels.fetch(id)
			.catch(() => null)

		if (!channel?.isTextBased() || channel.isDMBased()) {
			return null
		}

		const me = channel.guild?.members.me
		const permissions = me ? channel.permissionsFor(me) : null

		return requiredPermissions.every(permission => permissions?.has(permission)) ? channel : null
	}
}

module.exports = {
	VerificationManager: VerificationManager,
	verificationComponentPrefix: componentPrefix
}
