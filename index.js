require('dotenv-expand').expand(require('dotenv').config());
const axios = require('axios')
const fs = require('fs')
const { Client, GatewayIntentBits, Message, MessageFlags, PermissionsBitField } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { ActivityManager } = require('./helpers/activities')
const { AppStoreManager } = require('./helpers/app_store')
const { Database } = require('./helpers/database')
const { GifManager, gifButtonPrefix } = require('./helpers/gif')
const { GifDropManager, gifDropComponentPrefix } = require('./helpers/gif_drop')
const { KurozoraManager } = require('./helpers/kurozora')
const { LegalManager } = require('./helpers/legal')
const { Migrator } = require('./helpers/migrator')
const { MusicManager, musicComponentPrefix } = require('./helpers/music')
const { PollManager, pollComponentPrefix } = require('./helpers/poll')
const { StatsManager } = require('./helpers/stats')
const { StreamManager } = require('./helpers/stream')
const { TwitterManager } = require('./helpers/twitter')
const { UtilsManager } = require('./helpers/utils')
const { VerificationManager, verificationComponentPrefix } = require('./helpers/verification')
const { LinkCleaner, linkCleanerComponentPrefix } = require('./helpers/link_cleaner')
const { Player } = require('discord-player');
const { registerEvents } = require('./events/events')

// MARK: - Properties
const token = process.env['TOKEN']
const appID = process.env['APP_ID']
const ownerID = process.env['OWNER_ID']

const commands = []
const slashCommandFiles = fs.readdirSync('./commands/slashes')
	.filter(file => file.endsWith('.js'))
const contextMenuCommandFiles = fs.readdirSync('./commands/context menus')
	.filter(file => file.endsWith('.js'))

// Initialize client
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildEmojisAndStickers,
		GatewayIntentBits.GuildVoiceStates,
	]
})
client.player = new Player(client)
const rest = new REST({ version: '10' })
	.setToken(token)

// Initialize managers
const activityManager = new ActivityManager(client, rest)
const kurozoraManager = new KurozoraManager(client, rest)
const gifManager = new GifManager(client, rest, kurozoraManager)
const legalManager = new LegalManager()
const musicManager = new MusicManager(client, rest, client.player);
let pollManager
let appStoreManager
let statsManager
let gifDropManager
let linkCleaner
let verificationManager
(async () => {
	fs.mkdirSync('./database', { recursive: true })

	const db = new Database('./database/main.db')

	await new Migrator(db, './database/migrations').migrate()

	pollManager = new PollManager(client, db)
	appStoreManager = new AppStoreManager(client, db)
	statsManager = new StatsManager(client, db)
	gifDropManager = new GifDropManager(client, db, gifManager, kurozoraManager)
	linkCleaner = new LinkCleaner(db)
	verificationManager = new VerificationManager(client, db)

	await Promise.all([
		appStoreManager.start()
			.catch(error => console.error(error)),
		pollManager.start()
			.catch(error => console.error(error)),
		statsManager.start()
			.catch(error => console.error(error)),
		gifDropManager.start()
			.catch(error => console.error(error)),
		linkCleaner.start()
			.catch(error => console.error(error)),
		verificationManager.start()
			.catch(error => console.error(error))
	])
})()
const streamManager = new StreamManager(client, rest)
const twitterManager = new TwitterManager()
const utilsManager = new UtilsManager(client, rest)

// Add commands
for (const file of slashCommandFiles) {
	const command = require(`./commands/slashes/${file}`)
	commands.push(command.data.toJSON())
}

for (const file of contextMenuCommandFiles) {
	const command = require(`./commands/context menus/${file}`)
	commands.push(command.data.toJSON())
}

(async () => {
	try {
		console.log('Started refreshing application (/) commands.')
		await rest.put(
			Routes.applicationCommands(appID),
			{
				body: commands
			},
		)
		console.log('Successfully reloaded application (/) commands.')
	} catch (error) {
		console.error(error)
	}
})()

// MARK: - Event Listeners
registerEvents(client)

/** Runs when a message is created by a user. */
client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild()) {
		return
	}

	if (message.content.toLowerCase() === 'bad bot') {
		return await undoLastCommand(message)
	}

	if (!message.member.permissions.has(PermissionsBitField.Flags.SendMessages)) {
		return
	}

	return await linkCleaner?.clean(message)
})

/** Runs when an interaction is created by a user. */
client.on('interactionCreate', async interaction => {
	if (interaction.isAutocomplete()) {
		return await handleAutocomplete(interaction)
	} else if (interaction.isContextMenuCommand()) {
		statsManager?.record(interaction)
			.catch(error => console.error(error))
		return await handleContextMenu(interaction)
	} else if (interaction.isCommand()) {
		statsManager?.record(interaction)
			.catch(error => console.error(error))
		return await handleCommand(interaction)
	} else if (interaction.isStringSelectMenu()) {
		return await handleSelectMenu(interaction)
	} else if (interaction.isButton()) {
		return await handleButton(interaction)
	} else if (interaction.isModalSubmit()) {
		return await handleModal(interaction)
	}
})

// MARK: - Functions
/**
 * Handles the selected command.
 *
 * @param interaction - interaction
 * @returns {Promise<*>}
 */
async function handleCommand(interaction) {
	const { commandName } = interaction

	switch (commandName) {
		case 'cat': {
			await interaction.deferReply()
			const {url} = await getCat()
			return interaction.editReply({files: [url]})
		}
		case 'dog': {
			await interaction.deferReply()
			const {url} = await axios.get('https://random.dog/woof.json')
				.then(response => response.data)
			return interaction.editReply({files: [url]})
		}
		case 'fox': {
			await interaction.deferReply()
			const {image} = await axios.get('https://randomfox.ca/floof')
				.then(response => response.data)
			return interaction.editReply({files: [image]})
		}
		case 'gif': {
			let query = interaction.options.getString('query')
			return await gifManager.reply(interaction, query)
		}
		case 'gifdrop': {
			return await gifDropManager.handle(interaction)
				.catch(error => console.error(error))
		}
		case 'search': {
			await interaction.deferReply()
			let type = interaction.options.getString('type')
			let query = interaction.options.getString('query')
			return await kurozoraManager.search(interaction, type, query)
		}
		case 'play': {
			await interaction.deferReply()
			let activity = interaction.options.getString('activity')
			let voiceChannel = interaction.member.voice.channel

			if (!voiceChannel) return interaction.editReply('Connect to a voice channel first.')

			let code = await activityManager.activityInvite(voiceChannel, activity)

			if (code) {
				return interaction.editReply('https://discord.gg/' + code)
			}

			return interaction.editReply('An invite link can’t be generated at this moment.')
		}
		case 'poll': {
			return await pollManager.create(interaction)
				.catch(error => console.error(error))
		}
		case 'stream': {
			let user = interaction.member
			let voiceChannel = interaction.member.voice.channel

			if (!voiceChannel) {
				return interaction.reply({
					content: '❌ | Connect to a voice channel first.',
					flags: MessageFlags.Ephemeral
				})
			}

			await interaction.deferReply()
			let code = await streamManager.streamInvite(voiceChannel, user)

			if (code) {
				return interaction.editReply('https://discord.gg/' + code)
			}

			return interaction.editReply('An invite link can‘t be generated at this moment.')
		}
		case 'music': {
			let voiceChannel = interaction.member.voice.channel
			let command = interaction.options.getSubcommand()

			if (command !== 'search') {
				if (!confirmConnectedToVC(voiceChannel, interaction)) {
					return
				}
			}

			switch (command) {
				case 'queue': {
					let target = interaction.options.getString('target')
					return await musicManager.queue(voiceChannel, interaction, target)
				}
				case 'search': {
					let target = interaction.options.getString('target')
					return await musicManager.search(interaction, target)
				}
				case 'play': {
					return musicManager.play(interaction)
				}
				case 'pause': {
					return musicManager.pause(interaction)
				}
				case 'forwards': {
					return musicManager.forwards(interaction)
				}
				case 'backwards': {
					return musicManager.backwards(interaction)
				}
				case 'shuffle': {
					return musicManager.shuffle(interaction)
				}
				case 'loop': {
					return musicManager.loop(interaction)
				}
				case 'volume': {
					return musicManager.volume(interaction)
				}
				case 'clear': {
					return musicManager.clear(interaction)
				}
				case 'list': {
					return musicManager.list(interaction)
				}
				default:
					return interaction.reply({
						content: `This command is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
						flags: MessageFlags.Ephemeral
					})
			}
		}
		case 'twitter': {
			let command = interaction.options.getSubcommand()

			switch (command) {
				case 'video': {
					let link = interaction.options.getString('link')
					return await twitterManager.post(interaction, link)
				}
				default:
					return interaction.reply({
						content: `This command is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
						flags: MessageFlags.Ephemeral
					})
			}
		}
		case 'flip': {
			return utilsManager.flipCoin(interaction)
		}
		case 'privacy': {
			return await legalManager.privacyPolicy(interaction)
		}
		case 'stats': {
			return await statsManager.report(interaction)
				.catch(error => console.error(error))
		}
		case 'linkcleaner': {
			return await linkCleaner.handle(interaction)
				.catch(error => console.error(error))
		}
		case 'verification': {
			return await verificationManager.handle(interaction)
				.catch(error => console.error(error))
		}
		default:
			return interaction.reply({
				content: `This command is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
				flags: MessageFlags.Ephemeral
			})
	}
}

/**
 * Handles the focused command option.
 *
 * @param interaction - interaction
 * @returns {Promise<*>}
 */
async function handleAutocomplete(interaction) {
	switch (interaction.commandName) {
		case 'gif': {
			return await gifManager.autocomplete(interaction)
		}
		case 'music': {
			return await musicManager.autocomplete(interaction)
		}
		default:
			return interaction.respond([])
				.catch(error => console.error(error))
	}
}

/**
 * Handles the selected context menu.
 *
 * @param interaction - interaction
 * @returns {Promise<*>}
 */
async function handleContextMenu(interaction) {
	switch (interaction.commandName) {
		case 'Search Anime': {
			return await searchTypeInKurozora(interaction, 'shows')
		}
		case 'Search Character': {
			return await searchTypeInKurozora(interaction, 'characters')
		}
		case 'Search Game': {
			return await searchTypeInKurozora(interaction, 'games')
		}
		case 'Search Manga': {
			return await searchTypeInKurozora(interaction, 'literatures')
		}
		case 'Search Person': {
			return await searchTypeInKurozora(interaction, 'people')
		}
		case 'Search Studio': {
			return await searchTypeInKurozora(interaction, 'studios')
		}
		case 'Post Video': {
			return await twitterManager.postFrom(interaction, interaction.targetMessage)
		}
		case 'Create Poll': {
			return await pollManager.create(interaction, interaction.targetMessage.content)
				.catch(error => console.error(error))
		}
		default:
			return interaction.reply({
				content: `This context menu command is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
				flags: MessageFlags.Ephemeral
			})
	}
}

/**
 * Search the specified type in Kurozora.
 *
 * @param interaction
 * @param type
 * @returns {Promise<*|void>}
 */
async function searchTypeInKurozora(interaction, type) {
	await interaction.deferReply()

	let regex = /(?<delim>`)([^`]+)\k<delim>/gi
	let message = await interaction.channel.messages.fetch(interaction.targetId)
	let matches = [...message.content.matchAll(regex)]

	if (matches.length) {
		let query = matches[0][2]
		return await kurozoraManager.search(interaction, type, query)
	} else {
		await interaction.deleteReply()
			.catch(error => console.error(error))

		return interaction.followUp({
			content: 'No anime title found. Please make sure to surround the title with a delimiter such as: `title`, [[title]] or ((title))',
			flags: MessageFlags.Ephemeral
		})
	}
}

/**
 * Handles the selected menu.
 *
 * @param interaction - interaction
 * @returns {Promise<void>}
 */
async function handleSelectMenu(interaction) {
	if (interaction.customId.startsWith(musicComponentPrefix)) {
		return await musicManager.handleComponent(interaction)
	}

	if (interaction.customId.startsWith(pollComponentPrefix)) {
		return await pollManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	return interaction.reply({
		content: `This select menu is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
		flags: MessageFlags.Ephemeral
	})
}

/**
 * Handles the selected button.
 *
 * @param interaction - interaction
 * @returns {Promise<void>}
 */
async function handleButton(interaction) {
	if (interaction.customId.startsWith(linkCleanerComponentPrefix)) {
		return await linkCleaner.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	if (interaction.customId.startsWith(verificationComponentPrefix)) {
		return await verificationManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	if (interaction.customId.startsWith(gifDropComponentPrefix)) {
		return await gifDropManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	if (interaction.customId.startsWith(gifButtonPrefix)) {
		return
	}

	if (interaction.customId.startsWith(musicComponentPrefix)) {
		return await musicManager.handleComponent(interaction)
	}

	if (interaction.customId.startsWith(pollComponentPrefix)) {
		return await pollManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	return interaction.reply({
		content: `This button is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
		flags: MessageFlags.Ephemeral
	})
}

/**
 * Handles the submitted modal.
 *
 * @param interaction - interaction
 * @returns {Promise<void>}
 */
async function handleModal(interaction) {
	if (interaction.customId.startsWith(verificationComponentPrefix)) {
		return await verificationManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	if (interaction.customId === `${pollComponentPrefix}_create`) {
		return await pollManager.compose(interaction)
			.catch(error => console.error(error))
	}

	if (interaction.customId.startsWith(gifDropComponentPrefix)) {
		return await gifDropManager.handleComponent(interaction)
			.catch(error => console.error(error))
	}

	return interaction.reply({
		content: `This form is work in progress, or **<@${ownerID}>** made a typo so it wasn’t recognized. Please notify.`,
		flags: MessageFlags.Ephemeral
	})
}

/**
 * Get a random cat picture and return the response.
 */
async function getCat() {
	const response = await axios.get('https://api.thecatapi.com/v1/images/search')
		.then(response => response.data)
		.catch(error => console.error(error))

	if (typeof response[0] === 'undefined') {
		return getCat()
	}

	return response[0]
}

/**
 * Confirms the user has joined a voice channel.
 *
 * @param {VoiceChannel} voiceChannel - voice channel
 * @param {Interaction} interaction - interaction
 */
function confirmConnectedToVC(voiceChannel, interaction) {
	if (!voiceChannel) {
		interaction.reply({
			content: '❌ | Connect to a voice channel first.',
			flags: MessageFlags.Ephemeral
		}).catch(e => console.error(e))
		return false
	}
	return true
}

/**
 * Deletes the bot’s last answer to the author.
 *
 * @param {Message} message - message
 *
 * @returns {Promise<void>}
 */
async function undoLastCommand(message) {
	const messages = await message.channel.messages.fetch({ limit: 2 })
		.catch(error => console.error(error))
	const lastMessage = messages?.last()

	if (lastMessage?.author.id !== client.user.id || message.author.id !== lastMessage.interaction?.user.id) {
		return
	}

	await lastMessage.delete()
		.catch(error => console.error(error))

	await message.delete()
		.catch(error => console.error(error))
}

// Login client
client.login(token)
