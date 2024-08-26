const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('cat')
	.setDescription('Cute cat pictures!')

module.exports = {
	data: data
}