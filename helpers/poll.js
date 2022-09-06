const { Interaction, MessageActionRow, MessageButton, MessageEmbed, MessageSelectMenu, Permissions, ThreadManager } = require('discord.js')
const moment = require('moment')
const { Database } = require('sqlite')

class PollManager {
	// MARK: - Properties
	/**
	 * @param {Client} client - client
	 */
	client

	/**
	 * @param {Database} db - datbase
	 */
	db

	/**
	 * @param {MessageActionRow} closeButton - close button
	 */
	closeButton = new MessageActionRow()
		.addComponents(
			new MessageButton()
				.setCustomId('close_poll')
				.setLabel('Close Poll')
				.setStyle('DANGER'),
		)

	// MARK: - Initializers
	/**
	 * @constructor
	 *
	 * @param {Client} client - Client
	 * @param {Database} db - Database
	 */
	constructor(client, db) {
		this.client = client
		this.db = db
	}

	// MARK: - Functions
	/**
	 * Create a new poll.
	 *
	 * @param {Interaction} interaction - interaction
	 * @returns {Promise<void>}
	 */
	async create(interaction) {
		const pollOptions = interaction.options.getString('options')
		const embedTitle = interaction.options.getString('title')
		const embedDescription = interaction.options.getString('description').replaceAll('\\n', '\n')
		const createThread = interaction.options.getBoolean('thread')
		const publicPoll = interaction.options.getBoolean('public')

		let roleName = 'Poll Manager'

		if (interaction.guild.roles.cache.find(role => role.name == roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {
			if (interaction.member.roles.cache.some(role => role.name === roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {
				const pollOptionsArr = [...new Set(pollOptions.split(','))]
				const labelArr = pollOptionsArr.map(x => ({
					label: x,
					value: x,
					voteCount: 0
				}))

				if (pollOptionsArr.length > 25) {
					interaction.reply({
						content: `Sorry! The poll you tried to create has more than 25 items(${pollOptionsArr.length}) unfortunately this is a Discord limitation, please remove some options from the poll.`,
						ephemeral: true,
					}).catch(error => console.error(error))
				} else {
					const selectionMenu = new MessageActionRow()
						.addComponents(
							new MessageSelectMenu()
								.setCustomId('poll')
								.setPlaceholder('Select an option...')
								.addOptions(labelArr),
						)
					const embed = new MessageEmbed()
						.setColor('#FF9300')
						.setTitle(embedTitle)
						.setDescription(embedDescription)

					try {
						await interaction.reply({
							embeds: [embed],
							components: [selectionMenu, this.closeButton]
						})
					} catch (err) {
						return interaction.reply({
							content: 'Could not vote. Please ping **<@259790276602626058>** for help if the issue keeps occuring.',
							ephemeral: true,
						})
					}

					// ----------------------------------------------------------------
					const message = await interaction.fetchReply()

					await this.db.exec(`CREATE TABLE "poll-${message.id}" ("lastInteraction" TEXT, "commandInput" TEXT, "guildName" TEXT, "guildId" INTEGER, "channelName" TEXT, "channelId" INTEGER, "pollTitle" TEXT, "pollDesc" TEXT, "pollItem" TEXT, "voteCount" INTEGER, "publicPoll" TEXT)`)
					await this.db.exec(`CREATE TABLE "user-${message.id}" ("userName" TEXT, "userId" INTEGER, "pollItem" TEXT)`)

					let date = moment()
					let placeholders = pollOptionsArr.map((movie) => `(${interaction.guild.id}, ${interaction.channel.id}, ?, 0)`).join(',')
					let sql = `INSERT INTO "poll-${message.id}"(guildId, channelId, pollItem, voteCount) VALUES ${placeholders}`
					let sql2 = `UPDATE "poll-${message.id}" SET lastInteraction = ?, commandInput = ?, guildName = ?, channelName = ?, pollTitle = ?, pollDesc = ?, publicPoll = ?`

					try {
						await this.db.run(sql, pollOptionsArr)
						await this.db.run(sql2, `${date}`, `/poll title: ${embedTitle} description: ${embedDescription} items: ${pollOptions}`, `${interaction.guild.name}`, `${interaction.channel.name}`, `${embedTitle}`, `${embedDescription}`, `${publicPoll}`)
					} catch (err) {
						console.error(err)
					}

					if (createThread == true) {
						if (interaction.channel.permissionsFor(interaction.applicationId).has(['MANAGE_THREADS'])) {
							const thread = await interaction.channel.threads.create({
								startMessage: message.id,
								name: `${embedTitle}`,
								autoArchiveDuration: 1440,
								reason: 'Thread created for a poll.',
							})
						} else {
							const threadEmbed = new MessageEmbed()
								.setColor('#FF9300')
								.setTitle(`Thread Creation Error`)
								.setDescription(`An error occured while creating the thread for the poll.\n\nPlease add the \`MANAGE_THREADS\` permission to access this feature.`)
								.setImage('https://support.discord.com/hc/article_attachments/4406694690711/image1.png')
								.setTimestamp()

							await interaction.followUp({
								embeds: [threadEmbed],
								ephemeral: true,
							})
						}
					}
				}
			} else {
				interaction.reply({
					content: 'Sorry you don’t have the "Poll Manager" role.',
					ephemeral: true,
				}).catch(error => console.error(error))
			}
		} else {
			if (interaction.channel.permissionsFor(interaction.applicationId).has(['MANAGE_ROLES'])) {
				interaction.guild.roles.create({
					name: roleName,
					color: '#FF9300',
					reason: 'Automatically creating "Poll Manager" for bot functions.'
				}).then(role => {
					interaction.reply({
						content: 'It appears you don’t have permission to create polls.\nPlease ask an admin/mod to run the \`/poll\` command for you.',
						ephemeral: true,
					}).catch(error => console.error(error))
				})
			} else {
				interaction.reply({
					content: `It appears you don’t have permission to create polls.\nPlease ask an admin/mod to run the \`/poll\` command for you.`,
					ephemeral: true,
				}).catch(error => console.error(error))
			}
		}
	}

	/**
	 * Update user vote.
	 *
	 * @param {Interaction} interaction - interaction
	 * @returns {Promise<void>}
	 */
	async update(interaction) {
		let choice = interaction.values[0]
		let member = interaction.member
		let sql = Object.values(await this.db.get(`SELECT EXISTS(SELECT userId FROM "user-${interaction.message.id}" WHERE userId = ${member.id} LIMIT 1);`))
		let date = moment()
		let publicPoll = Object.values(await this.db.get(`SELECT EXISTS(SELECT publicPoll
																	   FROM "poll-${interaction.message.id}"
																	   WHERE publicPoll = "true" LIMIT 1);`))

		// Checking if users contains the userId of current voter.
		if (sql[0]) {
			let user = Object.values(await this.db.get(`SELECT *
													  FROM "user-${interaction.message.id}"
													  WHERE userId = ${member.id} LIMIT 1;`))
			let originalChoice = user[2];
			await this.db.run(`UPDATE "user-${interaction.message.id}"
							  SET pollItem = ?
							  WHERE userId = ${member.id}`, `${choice}`)
			await this.db.run(`UPDATE "poll-${interaction.message.id}"
							  SET voteCount = voteCount + 1
							  WHERE pollItem = ?`, `${choice}`)
			await this.db.run(`UPDATE "poll-${interaction.message.id}"
							  SET voteCount = voteCount - 1
							  WHERE pollItem = ?`, `${originalChoice}`)
			await this.db.run(`UPDATE "poll-${interaction.message.id}"
							  SET lastInteraction = ?`, `${date}`)

			if (publicPoll[0] === 1) {
				const result = await this.db.all(`SELECT *
												 FROM "poll-${interaction.message.id}"
												 ORDER BY voteCount DESC`)
				let pollItemLoop = []
				let graphLoop = []
				let graphTotalVotes = 0

				for (let i = 0; i < result.length; i++) {
					pollItemLoop.push(`${result[i].pollItem}`)
					graphTotalVotes += result[i].voteCount
				}

				for (let i = 0; i < result.length; i++) {
					let dots = '▮'.repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
					let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
					let empty = '▯'.repeat(left)
					graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`)
				}

				let pollItem = pollItemLoop.toString().split(',').join('\r\n')
				let graph = graphLoop.toString().split(',').join('\r\n')

				const embed = new MessageEmbed()
					.setColor('#FF9300')
					.setTitle(`${interaction.message.embeds[0].title}`)
					.setDescription(`${interaction.message.embeds[0].description}`)
					.addField(`Option`, pollItem, true)
					.addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)

				await interaction.update({
					embeds: [embed],
				}).catch(error => console.error(error))

				return await interaction.followUp({
					content: `Your vote has changed from "${originalChoice}" to "${choice}".`,
					fetchReply: true,
					ephemeral: true
				}).catch(error => console.error(error))
			}

			return await interaction.reply({
				content: `Your vote has changed from "${originalChoice}" to "${choice}".`,
				fetchReply: true,
				ephemeral: true
			}).catch(error => console.error(error))
		}

		await this.db.run(`INSERT INTO "user-${interaction.message.id}" (userName, userId, pollItem)
						  VALUES (?, ?, ?)`, `${member.displayName}`, `${member.id}`, `${choice}`)
		await this.db.run(`UPDATE "poll-${interaction.message.id}"
						  SET voteCount = voteCount + 1
						  WHERE pollItem = ?`, `${choice}`)
		await this.db.run(`UPDATE "poll-${interaction.message.id}"
						  SET lastInteraction = ?`, `${date}`)

		if (publicPoll[0] === 1) {
			const result = await this.db.all(`SELECT *
											 FROM "poll-${interaction.message.id}"
											 ORDER BY voteCount DESC`)
			let pollItemLoop = []
			let graphLoop = []
			let graphTotalVotes = 0

			for (let i = 0; i < result.length; i++) {
				pollItemLoop.push(`${result[i].pollItem}`)
				graphTotalVotes += result[i].voteCount
			}

			for (let i = 0; i < result.length; i++) {
				let dots = '▮'.repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
				let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
				let empty = '▯'.repeat(left)
				graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`)
			}

			let pollItem = pollItemLoop.toString().split(',').join('\r\n')
			let graph = graphLoop.toString().split(',').join('\r\n')

			const embed = new MessageEmbed()
				.setColor('#FF9300')
				.setTitle(`${interaction.message.embeds[0].title}`)
				.setDescription(`${interaction.message.embeds[0].description}`)
				.addField(`Option`, pollItem, true)
				.addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)

			await interaction.update({
				embeds: [embed],
			}).catch(error => console.error(error))

			return await interaction.followUp({
				content: `"${choice}" chosen.`,
				fetchReply: true,
				ephemeral: true
			}).catch(error => console.error(error))
		}

		return await interaction.reply({
			content: `"${choice}" chosen.`,
			fetchReply: true,
			ephemeral: true
		}).catch(error => console.error(error))
	}

	/**
	 * Close a poll.
	 *
	 * @param {Interaction} interaction - interaction
	 * @returns {Promise<void>}
	 */
	async close(interaction) {
		let roleName = 'Poll Manager'

		if (interaction.member.roles.cache.some(role => role.name === roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {
			const result = await this.db.all(`SELECT *
											 FROM "poll-${interaction.message.id}"
											 ORDER BY voteCount DESC`)
			let pollItemLoop = []
			let graphLoop = []
			let graphTotalVotes = 0

			for (let i = 0; i < result.length; i++) {
				pollItemLoop.push(`${result[i].pollItem}`)
				graphTotalVotes += result[i].voteCount
			}

			for (let i = 0; i < result.length; i++) {
				let dots = '▮'.repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
				let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10))
				let empty = '▯'.repeat(left)
				graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`)
			}

			let pollItem = pollItemLoop.toString().split(',').join('\r\n')
			let graph = graphLoop.toString().split(',').join('\r\n')

			const embed = new MessageEmbed()
				.setColor('#FF9300')
				.setTitle(`${interaction.message.embeds[0].title}`)
				.setDescription(`${interaction.message.embeds[0].description}`)
				.addField(`Option`, pollItem, true)
				.addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)
				.setFooter(`Poll closed at ${interaction.createdAt} by ${interaction.member.displayName}`)

			try {
				await interaction.update({
					embeds: [embed],
					components: [],
				})
			} catch (error) {
				console.error(error)

				await interaction.reply({
					content: 'There was an issue while closing the poll.',
					ephemeral: true,
				})
			}

			try {
				await this.db.exec(`DROP TABLE "poll-${interaction.message.id}";`)
				await this.db.exec(`DROP TABLE "user-${interaction.message.id}";`)
			} catch (error) {
				console.log('----- Error while dropping poll table', error)
			}

			return
		}

		return interaction.reply({
			content: 'Sorry you don’t have permission to close the poll.',
			ephemeral: true
		}).catch(error => console.error(error))
	}
}

module.exports = {
	PollManager: PollManager
}
