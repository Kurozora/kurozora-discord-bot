const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js')

const data = new ContextMenuCommandBuilder()
    .setName('Search Manga')
    .setType(ApplicationCommandType.Message);

module.exports = {
    data: data
}
