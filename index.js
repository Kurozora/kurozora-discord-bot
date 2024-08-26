require('dotenv').config();
const axios = require('axios')
const fs = require('fs')
const moment = require('moment')
const { Client, GatewayIntentBits, Partials, PermissionsBitField, MessageEmbed } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { ActivityManager } = require('./helpers/activities')
const { AnimeManager } = require('./helpers/anime')
const { KurozoraManager } = require('./helpers/kurozora')
const { MusicManager } = require('./helpers/music')
const { PollManager } = require('./helpers/poll')
const { StreamManager } = require('./helpers/stream')
const { UtilsManager } = require('./helpers/utils')
const { open } = require('sqlite')
const sqlite3 = require('sqlite3').verbose()
const { Player } = require('discord-player');
const { registerEvents } = require('./events/events')
const { AnimeGifType } = require('./enums/AnimeGifType')
const urlShorteners = require('./resources/url_shorteners.json')

// MARK: - Properties
const prefix = 'k!'
const webhookName = 'Kurozora_webhook'
const token = process.env['TOKEN']
const appID = process.env['APP_ID']
var kurozoraGuildID = '449250093623934977'
var channelID = '935269731349430352'
var channel = null

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
const animeManager = new AnimeManager(client, rest)
const kurozoraManager = new KurozoraManager(client, rest)
const musicManager = new MusicManager(client, rest, client.player);
var pollManager
(async () => {
	const db = await open({
		filename: './database/main.db',
		driver: sqlite3.Database
	})
	pollManager = new PollManager(client, db)
})()
const streamManager = new StreamManager(client, rest)
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
	// Don’t do anything if it's from a bot or doesn’t start with the prefix
	if (message.author.bot) {
		return
	}

	if (message.content.toLowerCase() === 'bad bot') {
		// Get the last two messages sent in the channel
		message.channel.messages.fetch({
			limit: 2
		}).then(messages => {
			const lastMessage = messages.last();

			// Check if the last message was sent by the bot
			if (lastMessage.author.id === client.user.id) {
				// check if the user who sent the "bad bot" message is the same as the user who triggered the bot
				if (message.author.id === lastMessage.interaction.user.id) {
					lastMessage.delete();
					message.delete()
				}
			}
		}).catch(console.error);
	}

	if (message.guild.id != kurozoraGuildID) {
		return
	}

	if (!message.content.startsWith(prefix)) {
		if (!message.member.permissions.has(PermissionsBitField.Flags.SendMessages)) {
			return
		}

		const regexp = /https?:\/\/\S+/g;
		const links = [...message.content.matchAll(regexp)]

		if (links.length) {
			const cleanLinks = []

			for (const link of links) {
				const trimmedLink = link[0].trim()
				const isShortened = isShortenedLink(trimmedLink)
				const cleanUrl = await cleanUrlTracking(trimmedLink, isShortened)
				let cleanLink = cleanUrl.trim()

				// Twitter
				if (cleanLink.includes('twitter.com') || cleanLink.includes('t.co')) {
					cleanLink = cleanTwitterLink(cleanLink)
				}

				// YouTube
				if (cleanLink.includes('youtube.com') || cleanLink.includes('youtu.be')) {
					cleanLink = cleanYouTubeLink(cleanLink)
				}

				try {
					cleanLink = decodeURIComponent(cleanLink)
				} catch (e) {
					console.error('----- Error decoding URI', e)
				}

				if (trimmedLink.toLowerCase() !== cleanLink.toLowerCase()) {
					cleanLinks.push(cleanLink)
				}
			}

			if (!cleanLinks.length) {
				return
			}

			const thisOrThese =  cleanLinks.length === 1 ? 'this' : 'these'
			const payload = cleanLinks.join('\n')
			const response = `I cleaned ${thisOrThese} for you:\n${payload}`
			return message.reply(response)
		}

		return
	}

	// Perform the requested command
	if (message.content === `${prefix}setup`) {
		const args = message.content.slice(`${prefix.length}setup`).trim().split(/ +/g)

		let webhooks = await message.guild.fetchWebhooks()
			.then(webhook => webhook)
			.catch(console.error)

		if (webhooks.find(function(webhook) {
			console.log(webhook)
			return webhook.name === webhookName
		})) {
			return message.reply(`Webhook with the name "${webhookName}" already exists.`)
		}

		// Check for permissions because we don’t need everyone making webhooks!
		if (!message.member.permissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
			return message.channel.send('You are not authorized to do this!')
		}

		// What if the bot can’t do it?
		if (!message.guild.me.permissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
			return message.channel.send(`I don’t have the proper permission (Manage Webhooks) to make webhooks!`)
		}

		message.channel.createWebhook(webhookName)
			.then(webhook => console.log(`Created webhook ${webhook}`))
			.catch(console.error)

		message.channel.send(`Kurozora is all set up. Enjoy!`)
	} else if (message.content.startsWith(`${prefix}test`)) {
		sendMessageUsingWebhook(message)
	} else {
		message.channel.send('You need to enter a valid command!')
	}
})

/** Runs when an interaction is created by a user. */
client.on('interactionCreate', async interaction => {
	if (interaction.isContextMenuCommand()) {
		return await handleContextMenu(interaction)
	} else if (interaction.isCommand()) {
		return await handleCommand(interaction)
	} else if (interaction.isStringSelectMenu()) {
		return await handleSelectMenu(interaction)
	} else if (interaction.isButton()) {
		return await handleButton(interaction)
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
		case 'anime': {
			let type = interaction.options.getString('type')
			return await animeManager.search(interaction, type)
		}
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
					ephemeral: true
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
						content: 'This command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
						ephemeral: true
					})
			}
		}
		case 'flip': {
			return utilsManager.flipCoin(interaction)
		}
		default:
			return interaction.reply({
				content: 'This command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
				ephemeral: true
			})
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
		default:
			return interaction.reply({
				content: 'This context menu command is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
				ephemeral: true
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
		return interaction.channel.send({
			content: 'No anime title found. Please make sure to surround the title with a delimiter such as: `title`, [[title]] or ((title))',
			ephemeral: true
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
	switch (interaction.customId) {
		case 'poll': {
			return await pollManager.update(interaction)
				.catch(error => console.error(error))
		}
		default:
			return interaction.reply({
				content: 'This select menu is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
				ephemeral: true
			})
	}
}

/**
 * Handles the selected button.
 *
 * @param interaction - interaction
 * @returns {Promise<void>}
 */
async function handleButton(interaction) {
	switch (interaction.customId) {
		case 'close_poll': {
			return await pollManager.close(interaction)
				.catch(error => console.error(error))
		}
		default:
			return interaction.reply({
				content: 'This button is work in progress, or **<@259790276602626058>** made a typo so it wasn’t recognized. Please notify.',
				ephemeral: true
			})
	}
}

/**
 * Determines whether the given url is shortened link.
 *
 * @param url
 * @returns {bool}
 */
function isShortenedLink(url) {
	const shortenerDomains = urlShorteners.domains
	const hostname = new URL(url).hostname
	return shortenerDomains.some(domain => hostname.endsWith(domain))
}

/**
 * Clean tracking parameters from the given url.
 *
 * Unshortens the url if `unshort` is set to true.
 *
 * @param {string} url - Link to clean
 * @param {bool} unshort - Whether to unshorten the url. Default is false.
 * @returns {*|Promise<*>}
 */
async function cleanUrlTracking(url, unshort = false) {
	return new Promise(function (success, nosuccess) {
		const {spawn} = require('child_process')
		const pythonScript = unshort ? './python/UnshortAndCleanUrlTracking.py' : './python/CleanUrlTracking.py'
		const cleanUrlTracking = spawn('./python/.venv/bin/python', [pythonScript, url])

		cleanUrlTracking.stdout.on('data', function (data) {
			console.log('stdout', data.toString())
			success(data)
		})

		cleanUrlTracking.stderr.on('data', (data) => {
			console.error(data.toString())
			nosuccess(data)
		})
	})
		.then(response => response.toString())
}

/**
 * Further cleans Twitter URLs.
 *
 * @param link
 * @returns {string}
 */
function cleanTwitterLink(link) {
	let url = new URL(link);
	url.searchParams.delete('t')
	return url.href
}

/**
 * Further cleans YouTube URLs.
 *
 * @param link
 * @returns {string}
 */
function cleanYouTubeLink(link) {
	let url = new URL(link);
	url.searchParams.delete('si')
	return url.href
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

// channel = await client.channels.fetch(channelID)
// 	.then(channel => channel)
// 	.catch(console.error)
// console.log(channel)
// getRandomAnimeGif()

async function getRandomAnimeGif() {
	let keys = Object.keys(AnimeGifType)
	let type = AnimeGifType[keys[ keys.length * Math.random() << 0]];
	let {url} = await animeManager.searchForType(type)
	return channel.send({files: [url]})
}

/**
 * Confirms the user has joined a voice channel.
 *
 * @param {VoiceChannle} voiceChannel - voice channel
 * @param {Interaction} interaction - interaction
 */
function confirmConnectedToVC(voiceChannel, interaction) {
	if (!voiceChannel) {
		interaction.reply({
			content: '❌ | Connect to a voice channel first.',
			ephemeral: true
		}).catch(e => console.error(e))
		return false
	}
	return true
}

async function sendMessageUsingWebhook(message) {
	let webhooks = await message.guild.fetchWebhooks()
		.then(webhook => webhook)
		.catch(console.error)

	let kWebhook = webhooks.find(function(webhook) {
		return webhook.name === webhookName
	})

	if (kWebhook) {
		const emoji = client.emojis.cache.find(emoji => emoji.name === 'lsd_')

		kWebhook.send({
			content: `${message.content} ${emoji}`,
			username: message.author.username,
			avatarURL: message.author.avatarURL(),
		})
	}
// message.channel.createWebhook(message.author.username, {avatar: message.author.avatarURL()}).then(webhook => {
// 	webhook.send(msg).then(() => {
// 		webhook.delete()
// 	})
// })
}

// Login client
client.login(token)
