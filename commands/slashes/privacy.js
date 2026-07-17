const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
	.setName('privacy')
	.setDescription('Read the Kurozora privacy policy and what data KuroBot handles.')

module.exports = {
	data: data
}
