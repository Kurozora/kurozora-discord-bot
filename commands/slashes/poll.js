const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll.')

module.exports = {
    data: data
}
