const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js')

const data = new ContextMenuCommandBuilder()
    .setName('Post Video')
    .setType(ApplicationCommandType.Message);

module.exports = {
    data: data
}
