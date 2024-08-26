const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('fox')
	.setDescription('Cute fox pictures!')

module.exports = {
	data: data
}