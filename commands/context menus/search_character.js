const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js')

const data = new ContextMenuCommandBuilder()
    .setName('Search Character')
    .setType(ApplicationCommandType.Message);

module.exports = {
    data: data
}
