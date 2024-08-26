const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('dog')
	.setDescription('Cute dog pictures and videos!')

module.exports = {
	data: data
}