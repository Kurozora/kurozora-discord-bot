const { SlashCommandBuilder } = require('@discordjs/builders')

const data = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll.')
    .addStringOption(option =>
        option.setName('title')
            .setDescription('The title of the poll. Keep it short.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('The descrption of the poll. Create newlines using \\n.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('options')
            .setDescription('Options to vote on. Add multiple options with a comma (,).')
            .setRequired(true))
    .addBooleanOption(option =>
        option.setName('public')
            .setDescription('Whether the results should be public at all times, otherwise only when the poll is closed.')
            .setRequired(true))
    .addBooleanOption(option =>
        option.setName('thread')
            .setDescription('Whether to create the poll in a thread.')
            .setRequired(false))

module.exports = {
    data: data
}
