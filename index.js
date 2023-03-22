require('dotenv').config();
const axios = require('axios')
const fs = require('fs')
const moment = require('moment')
const { Client, GatewayIntentBits, Partials, MessageEmbed } = require('discord.js')
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

// MARK: - Properties
const prefix = 'k!'
const webhookName = 'Kurozora_webhook'
const token = process.env['TOKEN']
const appID = process.env['APP_ID']
var channelID = '935269731349430352'
var channel = null

const commands = []
const commandFiles = fs.readdirSync('./commands')
	.filter(file => file.endsWith('.js'))

// Initialize client
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildEmojisAndStickers,
		GatewayIntentBits.GuildVoiceStates,
	]
})
client.player = new Player(client)
const rest = new REST({ version: '9' })
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
for (const file of commandFiles) {
	const command = require(`./commands/${file}`)
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

	if (!message.content.startsWith(prefix)) {
		const regexp = /https?:\/\/\S+/g;
		const links = [...message.content.matchAll(regexp)]

		if (links.length) {
			const cleanLinks = []

			for (const link of links) {
				const trimmedLink = link[0].trim()
				const cleanUrl = await cleanUrlTracking(trimmedLink)
				let cleanLink = cleanUrl.trim()

				// YouTube
				if (cleanLink.includes('youtube.com/shorts')) {
					cleanLink = convertShortsToVideo(cleanLink)
				}

				// Twitter
				if (cleanLink.includes('twitter.com') || cleanLink.includes('t.co')) {
					cleanLink = cleanTwitterLink(cleanLink)
				}

				if (trimmedLink.toLowerCase() !== cleanLink.toLowerCase()) {
					cleanLinks.push(cleanLink)
				}
			}

			if (!cleanLinks.length) {
				return
			}

			const plural =  cleanLinks.length === 1 ? 'is' : 'ese'
			const payload = cleanLinks.join('\n')
			const response = `I cleaned th${plural} for you:\n${payload}`
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
		if (!message.member.permissions.has('MANAGE_WEBHOOKS')) {
			return message.channel.send('You are not authorized to do this!')
		}

		// What if the bot can’t do it?
		if (!message.guild.me.permissions.has('MANAGE_WEBHOOKS')) {
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
	if (interaction.isCommand()) {
		return await handleCommand(interaction)
	} else if (interaction.isSelectMenu()) {
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
			const {file} = await getCat()
			return interaction.editReply({files: [file]})
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
 * Clean the given url from tracking
 *
 * @param {string} link
 * @returns {*|Promise<*>}
 */
async function cleanUrlTracking(link) {
	return new Promise(function (success, nosuccess) {
		const {spawn} = require('child_process')
		const cleanUrlTracking = spawn('python', ['./python/CleanUrlTracking.py', link])

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
 * Converts and returns a normal YouTube video URL.
 *
 * @param link
 * @returns {string}
 */
function convertShortsToVideo(link) {
	const arr = link.split(/(vi\/|v%3D|v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)/)
	const videoID = undefined !== arr[2] ? arr[2].split(/[^\w-]/i)[0] : arr[0]
	return 'https://youtube.com/watch?v=' + videoID;
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
 * Get a random cat picture and return the response.
 */
async function getCat() {
	const response = await axios.get('https://aws.random.cat/meow')
			.then(response => response.data)
			.catch(error => console.error(error))

	if (!response) {
		return getCat()
	}

	return response
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
