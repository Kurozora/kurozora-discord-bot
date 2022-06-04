const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('flip')
	.setDescription('Flips a coin.')

module.exports = {
	data: data
}
