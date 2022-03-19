const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('find')
	.setDescription('Find an anime on Kurozora!')
	.addStringOption(option =>
		option.setName('title')
			.setDescription('The title of the anime')
			.setRequired(true))

module.exports = {
	data: data
}