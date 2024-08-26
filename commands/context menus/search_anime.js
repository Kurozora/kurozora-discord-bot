const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js')

const data = new ContextMenuCommandBuilder()
    .setName('Search Anime')
    .setType(ApplicationCommandType.Message);

module.exports = {
    data: data
}