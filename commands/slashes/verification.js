const { SlashCommandBuilder } = require('@discordjs/builders')
const { ChannelType, PermissionFlagsBits } = require('discord.js')

const data = new SlashCommandBuilder()
	.setName('verification')
	.setDescription('Hold new members until they verify they’re human.')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.addSubcommand(subcommand => subcommand
		.setName('set')
		.setDescription('Choose the channel members verify in, and the role they’re given.')
		.addChannelOption(option => option
			.setName('channel')
			.setDescription('The channel members verify in.')
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
			.setRequired(true))
		.addRoleOption(option => option
			.setName('role')
			.setDescription('The role a verified member is given.')
			.setRequired(true))
		.addChannelOption(option => option
			.setName('log')
			.setDescription('The channel verifications are reported in.')
			.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PrivateThread, ChannelType.PublicThread))
		.addStringOption(option => option
			.setName('invite')
			.setDescription('The invite removed members are sent. One is created per removal when empty.')))
	.addSubcommand(subcommand => subcommand
		.setName('off')
		.setDescription('Let new members walk straight in again.'))
	.addSubcommand(subcommand => subcommand
		.setName('status')
		.setDescription('Read how verification is set up, and change it.'))
	.addSubcommand(subcommand => subcommand
		.setName('panel')
		.setDescription('Put the panel members verify from up.'))
	.addSubcommand(subcommand => subcommand
		.setName('member')
		.setDescription('Read how a member got in, and what their account carries.')
		.addUserOption(option => option
			.setName('member')
			.setDescription('The member to read.')
			.setRequired(true)))
	.addSubcommand(subcommand => subcommand
		.setName('approve')
		.setDescription('Verify a member yourself.')
		.addUserOption(option => option
			.setName('member')
			.setDescription('The member to verify.')
			.setRequired(true)))
	.addSubcommand(subcommand => subcommand
		.setName('backfill')
		.setDescription('Verify everyone who was here before verification was.'))
	.addSubcommand(subcommand => subcommand
		.setName('raid')
		.setDescription('Ask every join for a verified phone number, and let nobody pass without a challenge.')
		.addBooleanOption(option => option
			.setName('on')
			.setDescription('Whether raid mode is on.')
			.setRequired(true)))

module.exports = {
	data: data
}
