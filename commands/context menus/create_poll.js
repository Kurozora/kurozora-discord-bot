const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js')

const data = new ContextMenuCommandBuilder()
    .setName('Create Poll')
    .setType(ApplicationCommandType.Message);

module.exports = {
    data: data
}
