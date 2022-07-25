const axios = require('axios')
const { Client, Invite, MessageEmbed } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { SearchType } = require.main.require('./enums/SearchType')
const { CharacterStatus } = require.main.require('./enums/CharacterStatus')
const kurozoraURL = process.env['KUROZORA_URL']

class KurozoraManager {
    // MARK: - Properties
    /**
     * @param {Client} client - client
     */
    client

    /**
     * @param {REST} rest - rest
     */
    rest

    /**
     * @param {} indexEmojis = index emojis
     */
    indexEmojis = [
        '0️⃣',
        '1️⃣',
        '2️⃣',
        '3️⃣',
        '4️⃣',
        '5️⃣',
        '6️⃣',
        '7️⃣',
        '8️⃣',
        '9️⃣',
        '🔟',
    ]

    // MARK: - Initializers
    /**
     * @constructor
     *
     * @param {Client} client - Client
     * @param {REST} rest - Rest
     */
    constructor(client, rest) {
        this.client = client
        this.rest = rest
    }

    // MARK: - Functions
    /**
     * Search the Kurozora catalog.
     *
     * @param {Interaction} interaction - interaction
     * @param {string} type - search type
     * @param {string} searchQuery - search query
     *
     * @returns {Object<string, *>} data - data
     */
    async search(interaction, type, searchQuery) {
        let data = await this.#search(searchQuery, type)
        let embed = await this.#getSearchEmbed(interaction, type, data)

        if (typeof embed === 'string') {
            return await interaction.reply({
                content: embed
            }).cache(e => console.log(e))
        }

        await interaction.reply({
            content: `Search results for \`${searchQuery}\``,
            embeds: [embed]
        }).catch(e => console.error(e))

        const collector = interaction.channel.createMessageCollector({
            time: 30000,
            errors: ['time'],
            filter: message => message.author.id === interaction.user.id
        })

        collector.on('collect', async (query) => {
            query.delete()

            if (query.content.toLowerCase() === 'cancel') {
                collector.stop()
                return interaction.deleteReply()
            }

            const value = parseInt(query.content)

            if (!value || value <= 0 || value > data.length) {
                return collector.channel.send({
                    content: `❌ | Invalid response, try a value between **1** and **${data.length}** or **cancel**`,
                    ephemeral: true
                })
            }

            collector.stop()
            interaction.deleteReply()

            const selectedData = data[value - 1]
            var embed = await this.#gnerateEmbedForType(interaction.user, type, selectedData)

            // Send results
            return collector.channel.send({
                // content: content,
                embeds: [embed]
            }).catch(e => console.error(e))
        })

        collector.on('end', (message, reason) => {
            if (reason === 'time') {
                return collector.channel.send({
                    content: `❌ | Search timed out...`,
                    ephemeral: true,
                    allowedMentions: {
                        parse: [],
                        repliedUser: false
                    }
                })
            }
        })

        return
    }

    /**
     * Search the Kurozora catalog.
     *
     * @param {string} query - query
     * @param {string} type - type
     * @param {string} scope - scope
     * @param {number} limit - limit
     *
     * @returns {Object<string, *>} data - data
     */
    async #search(query, type, scope = 'kurozora', limit = 5) {
        const data = await axios.get(kurozoraURL + '/v1/search', {
            params: {
                'scope': scope,
                'types': [type],
                'query': query,
                'limit': limit,
            }
        })
            .then(async function(response) {
                const { data } = response.data

                switch (type) {
                    case SearchType.Anime: {
                        if (data?.shows.length != 0) {
                            const showIdentities = data.shows.data
                            var shows = []

                            for (let showIdentity of showIdentities) {
                                const show = await this.getShowDetails(showIdentity.href)

                                if (typeof show === 'string') {
                                    return show
                                }

                                shows.push(show)
                            }

                            return shows
                        }
                    }
                    case SearchType.Characters: {
                        if (data?.characters.length != 0) {
                            const characterIdentities = data.characters.data
                            var characters = []

                            for (let characterIdentity of characterIdentities) {
                                const character = await this.getCharacterDetails(characterIdentity.href)

                                if (typeof character === 'string') {
                                    return character
                                }

                                characters.push(character)
                            }

                            return characters
                        }
                    }
                    default: break
                }

                return `No results were found for ${query} :(`
            }.bind(this))
            .catch(function(error) {
                console.error(error)
                return `No results were found for ${query} :(`
            })

        return data
    }

    /**
     * Get the details of a show.
     *
     * @param {string} url - url
     *
     * @returns {Object<string, *>|string}
     */
    async getShowDetails(url) {
        const data = await axios.get(kurozoraURL + url)
            .then(function(response) {
                const { data } = response.data

                if (data.length != 0) {
                    return data[0]
                }

                return `There was an error while fetching anime details :(`
            })
            .catch(function(error) {
                console.error(error)
                return `There was an error while fetching anime details :(`
            })

        return data
    }

    /**
     * Get the details of a character.
     *
     * @param {string} url - url
     *
     * @returns {Object<string, *>|string}
     */
    async getCharacterDetails(url) {
        const data = await axios.get(kurozoraURL + url)
            .then(function(response) {
                const { data } = response.data

                if (data.length != 0) {
                    return data[0]
                }

                return `There was an error while fetching character details :(`
            })
            .catch(function(error) {
                console.error(error)
                return `There was an error while fetching character details :(`
            })

        return data
    }

    // MARK: - Embeds
    /**
     * Get the embed for the searched data.
     *
     * @param {Interaction} interaction - interaction
     * @param {string} type - type
     * @param {Object<string, *>} data - data
     *
     * @returns {MessageEmbed}
     */
    async #getSearchEmbed(interaction, type, data) {
        const embed = new MessageEmbed()
        embed.setColor('#FF9300')
        embed.setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({
                size: 1024,
                dynamic: true
            })
        })

        switch (type) {
            case SearchType.Anime: {
                embed.setDescription(`${data.map((show, i) => `**${this.indexEmojis[i + 1]}** \`${show.attributes.tvRating.name}\` ${show.attributes.title} | **${show.attributes.status.name}**`).join('\n')}\n\nReply with **1** to **${data.length}** or **cancel** ⬇️`)
                break
            }
            case SearchType.Characters: {
                embed.setDescription(`${data.map((character, i) => `**${this.indexEmojis[i + 1]}** ${character.attributes.name}`).join('\n')}\n\nReply with **1** to **${data.length}** or **cancel** ⬇️`)
                break
            }
            case SearchType.Episodes: break
            case SearchType.People: break
            case SearchType.Studios: break
            default: break
        }

        embed.setTimestamp()
        return embed
    }

    /**
     * Generate an embed for the given type.
     *
     * @param {} user - user
     * @param {string} type - type
     * @param {Object<string, *>} data - data
     *
     * @returns {string|MessageEmbed}
     */
    #gnerateEmbedForType(user, type, data) {
        switch (type) {
            case SearchType.Anime:
                return this.#generateEmbedForShow(user, data)
            case SearchType.Characters:
                return this.#generateEmbedForCharacter(user, data)
            default:
                return 'Emtpy :('
        }
    }

    /**
     *  Generates a message embed for the given anime.
     *
     * @param {} user - user
     * @param {Object<string, *>} anime - anime
     *
     * @returns {MessageEmbed}
     */
    #generateEmbedForShow(user, anime) {
        const synopsis = anime.attributes.synopsis
        const poster = anime.attributes.poster
        const banner = anime.attributes.banner
        const kurozoraURL = `https://kurozora.app/anime/${anime.attributes.slug}`
        const copyright = anime.attributes.copyright
        const broadcast = this.#getBroadcast(anime)
        const aired = this.#getAirDates(anime)
        const airSeasonEmoji = this.#getAirSeasonEmoji(anime)
        const rating = this.#getRating(anime)
        const genres = this.#getGenres(anime)
        const themes = this.#getThemes(anime)

        const messageEmbed = new MessageEmbed()
            .setTitle(anime.attributes.title)
            .setURL(kurozoraURL)
            .setAuthor({
                name: user.username,
                iconURL: user.displayAvatarURL({
                    size: 1024,
                    dynamic: true
                })
            })

        if (synopsis) {
            messageEmbed.setDescription(synopsis)
        }

        if (poster) {
            messageEmbed.setThumbnail(poster.url)
                .setColor(poster.backgroundColor)
        } else {
            messageEmbed.setColor('#FF9300')
        }

        messageEmbed.addFields(
            {
                name: '⏳ Status',
                value: anime.attributes.status.name,
                inline: true
            },
            {
                name: `${airSeasonEmoji} Season`,
                value: anime.attributes.airSeason,
                inline: true
            },
            {
                name: '📺 Type',
                value: anime.attributes.type.name,
                inline: true
            },
            {
                name: '🎯 Source',
                value: anime.attributes.source.name,
                inline: true
            },
            {
                name: '🔣 TV Rating',
                value: anime.attributes.tvRating.name,
                inline: true
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            },
            {
                name: '🎭 Genres',
                value: genres
            },
            {
                name: '🎡 Themes',
                value: themes
            }
        )

        if (broadcast) {
            messageEmbed.addField('📡 Broadcast', broadcast, true)
        }

        if (aired) {
            messageEmbed.addField('📆 Aired', aired, true)
        }

        messageEmbed.addFields(
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            },
            {
                name: '🧂 Seasons',
                value: `${anime.attributes.seasonCount}`,
                inline: true
            },
            {
                name: '🎞 Episodes',
                value: `${anime.attributes.episodeCount}`,
                inline: true
            },
            {
                name: '⏱ Duration',
                value: anime.attributes.duration,
                inline: true
            },
            {
                name: '⏱ Duration Total',
                value: anime.attributes.durationTotal,
            }
        )

        if (rating) {
            messageEmbed.addField('⭐️ Rating', rating)
        }

        if (banner) {
            messageEmbed.setImage(banner.url)
        }

        if (copyright) {
            messageEmbed.setFooter({
                text: copyright,
            })
        }

        return messageEmbed
    }

    /**
     *  Generates a message embed for the given character.
     *
     * @param {} user - user
     * @param {Object<string, *>} character - character
     *
     * @returns {MessageEmbed}
     */
    #generateEmbedForCharacter(user, character) {
        const synopsis = character.attributes.synopsis
        const profile = character.attributes.profile
        const characterStatusEmoji = this.#characterStatusEmoji(character)
        const astrologicalSignEmoji = this.#astrologicalSignEmoji(character)
        const astrologicalSignString = this.#astrologicalSignString(character)
        const bWH = this.#getBWH(character)
        const kurozoraURL = `https://kurozora.app/characters/${character.attributes.slug}`

        const messageEmbed = new MessageEmbed()
            .setTitle(character.attributes.name)
            .setURL(kurozoraURL)
            .setAuthor({
                name: user.username,
                iconURL: user.displayAvatarURL({
                    size: 1024,
                    dynamic: true
                })
            })

        if (synopsis) {
            messageEmbed.setDescription(synopsis)
        }

        if (profile) {
            messageEmbed.setThumbnail(profile.url)
                .setColor(profile.backgroundColor)
        } else {
            messageEmbed.setColor('#FF9300')
        }

        messageEmbed.addFields({
                name: '🌟 Debut',
                value: character.attributes.debut ?? 'N/A',
                inline: true
            },
            {
                name: `${characterStatusEmoji} Status`,
                value: character.attributes.status,
                inline: true
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            })

        messageEmbed.addFields({
                name: '🎂 Birthday',
                value: character.attributes.birthdate ?? 'N/A',
                inline: true
            },
            {
                name: '📅 Age',
                value: character.attributes.age ?? 'N/A',
                inline: true
            },
            {
                name: `${astrologicalSignEmoji ?? ''} Astrological Sign`,
                value: astrologicalSignString ?? 'N/A',
                inline: true
            })

        messageEmbed.addFields({
                name: '📐 B/W/H',
                value: bWH.length ? bWH : 'N/A',
                inline: true
            },
            {
                name: '📏 Height',
                value: character.attributes.height ?? 'N/A',
                inline: true
            },
            {
                name: '⚖️ Weight',
                value: character.attributes.weight ?? 'N/A',
                inline: true
            })

        messageEmbed.addFields({
                name: 'Blood Type',
                value: character.attributes.bloodType ?? 'N/A',
                inline: true
            },
            {
                name: '🍽 Favorite Food',
                value: character.attributes.favoriteFood ?? 'N/A',
                inline: true
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            })

        return messageEmbed
    }

    // MARK: - Helpers
    /**
     * Get the broadcast of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {string}
     */
    #getBroadcast(anime) {
        var broadcast = ''
        const airDay = anime.attributes.airDay
        const airTime = anime.attributes.airTime

        if (airDay) {
            broadcast += `${airDay} `
        }

        if (airTime) {
            broadcast += `at ${airTime}UTC`
        }

        return broadcast
    }

    /**
     * Get the air dates of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {string}
     */
    #getAirDates(anime) {
        var aired = ''
        const firstAired = anime.attributes.firstAired
        const lastAired = anime.attributes.lastAired

        if (firstAired) {
            const date = new Date(firstAired * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            aired += `🚀 ${date}`
        }

        if (lastAired) {
            const date = new Date(lastAired * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            aired += `\n╰╍╍╍╍╍╍╍╍╮\n${date} 🏁`
        }

        return aired
    }

    /**
     * Get the air season emoji of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {string}
     */
    #getAirSeasonEmoji(anime) {
        switch (anime.attributes.airSeason) {
            case 'Spring':
                return '🍃'
            case 'Summer':
                return '☀️'
            case 'Fall':
                return '🍁'
            default:
                return '❄️'
        }
    }

    /**
     * Get the rating of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {?string}
     */
    #getRating(anime) {
        var rating = null
        const stats = anime.attributes.stats

        if (stats) {
            rating = `**${stats.ratingAverage}**/5.0 with **${this.abbreviateNumber(stats.ratingCount)}** Ratings`
        }

        return rating
    }

    /**
     * Get the genres of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {string}
     */
    #getGenres(anime) {
        var genres = 'N/A'
        const genresArray = anime.attributes.genres ?? []

        if (genresArray.length) {
            genres = genresArray.join(', ')
        }

        return genres
    }

    /**
     * Get the themes of the given anime.
     *
     * @param {Object<string, *>} anime - anime
     *
     * @returns {string}
     */
    #getThemes(anime) {
        var themes = 'N/A'
        const themesArray = anime.attributes.themes ?? []

        if (themesArray.length) {
            themes = themesArray.join(', ')
        }

        return themes
    }

    /**
     * Get the character status emoji of the given character.
     *
     * @param {Object<string, *>} character - character
     *
     * @returns {string}
     */
    #characterStatusEmoji(character) {
        switch (character.attributes.status) {
            case CharacterStatus.Unknown:
                return '🤷‍♂️'
            case CharacterStatus.Alive:
                return '☯️'
            case CharacterStatus.Deceased:
                return '🪦'
            case CharacterStatus.Missing:
                return '🕵‍♂️'
            default:
                return ''
        }
    }

    /**
     * Get the astrological sign emoji of the given object.
     *
     * @param {Object<string, *>} object - object
     *
     * @returns {string|null}
     */
    #astrologicalSignEmoji(object) {
        let astrologicalSign = object.attributes.astrologicalSign
        let emojis = this.getEmojisFrom(astrologicalSign)

        if (emojis?.length) {
            return emojis[0]
        }

        return null
    }

    /**
     * Get the astrological sign string of the given object.
     *
     * @param {Object<string, *>} object - object
     *
     * @returns {string}
     */
    #astrologicalSignString(object) {
        let astrologicalSign = object.attributes.astrologicalSign
        return this.removeEmojisFrom(astrologicalSign)
    }

    /**
     * Get the bust, waist and hip messurements of the given character.
     *
     * @param character
     *
     * @returns {string}
     */
    #getBWH(character) {
        let bust = character.attributes.bust
        let waist = character.attributes.waist
        let hip = character.attributes.hip
        var messurements = [bust, waist, hip]
        messurements = messurements.filter(element => element)
        return messurements.join('/')
    }

    /**
     * Abbreviates the given number to a more readable value.
     *
     * @param {number} value - value
     *
     * @returns {string}
     */
    abbreviateNumber(value) {
        return Intl.NumberFormat('en-US', {
            maximumFractionDigits: 1,
            notation: 'compact',
            compactDisplay: 'short'
        }).format(value)
    }

    /**
     * Separates emojis from the given string and returns an array of the string + all found emojis.
     *
     * @param {string|null} string - string
     *
     * @returns {string[]|null}
     */
    getEmojisFrom(string) {
        var regex = /\p{RI}\p{RI}|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?(\u{200D}\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?)+|\p{EPres}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})/gu
        return string?.match(regex)
    }

    /**
     * Separates emojis from the given string and returns an array of the string + all found emojis.
     *
     * @param {string|null} string - string
     *
     * @returns {string} string
     */
    removeEmojisFrom(string) {
        var regex = /\p{RI}\p{RI}|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?(\u{200D}\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?)+|\p{EPres}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})/gu
        return string?.replace(regex, '')
    }
}

module.exports = {
    KurozoraManager: KurozoraManager
}
