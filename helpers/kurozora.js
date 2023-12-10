const axios = require('axios')
const { Client, EmbedBuilder } = require('discord.js')
const { REST } = require('@discordjs/rest')
const { SearchType } = require.main.require('./enums/SearchType')
const { CharacterStatus } = require.main.require('./enums/CharacterStatus')
const kurozoraURL = process.env['KUROZORA_URL']
const kurozoraAPIURL = process.env['KUROZORA_API_URL']

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
            return await interaction.followUp({
                content: embed
            }).cache(e => console.log(e))
        }

        await interaction.followUp({
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
                console.log('----- value',  value, query.content.toLowerCase(), query.content, query);
                return collector.channel.send({
                    content: `❌ | Invalid response, try a value between **1** and **${data.length}** or **cancel**`,
                    ephemeral: true
                })
            }

            collector.stop()
            interaction.deleteReply()

            const selectedData = data[value - 1]
            var embed = await this.#generateEmbedForType(interaction.user, type, selectedData)

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
        const data = await axios.get(kurozoraAPIURL + '/v1/search', {
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
                        if (data?.shows.length !== 0) {
                            const showIdentities = data.shows.data
                            var shows = []

                            for (let showIdentity of showIdentities) {
                                const show = await this.getModelDetails(showIdentity.href)

                                if (typeof show === 'string') {
                                    return show
                                }

                                shows.push(show)
                            }
                            return shows
                        }
                    }
                    case SearchType.Manga: {
                        if (data?.literatures.length !== 0) {
                            const literatureIdentities = data.literatures.data
                            var literatures = []

                            for (let literatureIdentity of literatureIdentities) {
                                const literature = await this.getModelDetails(literatureIdentity.href)

                                if (typeof literature === 'string') {
                                    return literature
                                }

                                literatures.push(literature)
                            }

                            return literatures
                        }
                    }
                    case SearchType.Games: {
                        if (data?.games.length !== 0) {
                            const gameIdentities = data.games.data
                            var games = []

                            for (let gameIdentity of gameIdentities) {
                                const game = await this.getModelDetails(gameIdentity.href)

                                if (typeof game === 'string') {
                                    return game
                                }

                                games.push(game)
                            }

                            return games
                        }
                    }
                    case SearchType.Characters: {
                        if (data?.characters.length !== 0) {
                            const characterIdentities = data.characters.data
                            var characters = []

                            for (let characterIdentity of characterIdentities) {
                                const character = await this.getModelDetails(characterIdentity.href)

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
    async getModelDetails(url) {
        const data = await axios.get(kurozoraAPIURL + url)
            .then(function(response) {
                const { data } = response.data

                if (data.length !== 0) {
                    return data[0]
                }

                return `There was an error while fetching the details :(`
            })
            .catch(function(error) {
                console.error(error)
                return `There was an error while fetching the details :(`
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
     * @returns {EmbedBuilder}
     */
    async #getSearchEmbed(interaction, type, data) {
        const embed = new EmbedBuilder()
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
            case SearchType.Manga: {
                embed.setDescription(`${data.map((literature, i) => `**${this.indexEmojis[i + 1]}** \`${literature.attributes.tvRating.name}\` ${literature.attributes.title} | **${literature.attributes.status.name}**`).join('\n')}\n\nReply with **1** to **${data.length}** or **cancel** ⬇️`)
                break
            }
            case SearchType.Games: {
                embed.setDescription(`${data.map((game, i) => `**${this.indexEmojis[i + 1]}** \`${game.attributes.tvRating.name}\` ${game.attributes.title} | **${game.attributes.status.name}**`).join('\n')}\n\nReply with **1** to **${data.length}** or **cancel** ⬇️`)
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
     * @returns {string|EmbedBuilder}
     */
    #generateEmbedForType(user, type, data) {
        switch (type) {
            case SearchType.Anime:
                return this.#generateEmbedForShow(user, data)
            case SearchType.Manga:
                return this.#generateEmbedForLiterature(user, data)
            case SearchType.Games:
                return this.#generateEmbedForGame(user, data)
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
     * @returns {EmbedBuilder}
     */
    #generateEmbedForShow(user, anime) {
        const synopsis = anime.attributes.synopsis
        const poster = anime.attributes.poster
        const banner = anime.attributes.banner
        const webURL = `${kurozoraURL}/anime/${anime.attributes.slug}`
        const copyright = anime.attributes.copyright
        const broadcast = this.#getBroadcast(anime)
        const ran = this.#getRunningDates(anime)
        const runningSeasonEmoji = this.#getRunningSeasonEmoji(anime)
        const rating = this.#getRating(anime)
        const genres = this.#getGenres(anime)
        const themes = this.#getThemes(anime)

        const messageEmbed = new EmbedBuilder()
            .setTitle('📺 ' + anime.attributes.title)
            .setURL(webURL)
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
                name: `${runningSeasonEmoji} Season`,
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
            messageEmbed.addFields({
                name: '📡 Broadcast',
                value: broadcast,
                inline: true
            })
        }

        if (ran) {
            messageEmbed.addFields({
                name: '📆 Aired',
                value: ran,
                inline: true
            })
        }

        messageEmbed.addFields({
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
            messageEmbed.addFields({
                name: '⭐️ Rating',
                value: rating
            })
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
     *  Generates a message embed for the given manga.
     *
     * @param {} user - user
     * @param {Object<string, *>} literature - literature
     *
     * @returns {EmbedBuilder}
     */
    #generateEmbedForLiterature(user, literature) {
        const synopsis = literature.attributes.synopsis
        const poster = literature.attributes.poster
        const banner = literature.attributes.banner
        const webURL = `${kurozoraURL}/manga/${literature.attributes.slug}`
        const copyright = literature.attributes.copyright
        const broadcast = this.#getBroadcast(literature)
        const ran = this.#getRunningDates(literature)
        const runningSeasonEmoji = this.#getRunningSeasonEmoji(literature)
        const rating = this.#getRating(literature)
        const genres = this.#getGenres(literature)
        const themes = this.#getThemes(literature)

        const messageEmbed = new EmbedBuilder()
            .setTitle('📙 ' + literature.attributes.title)
            .setURL(webURL)
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
                value: literature.attributes.status.name,
                inline: true
            },
            {
                name: `${runningSeasonEmoji} Season`,
                value: literature.attributes.publicationSeason,
                inline: true
            },
            {
                name: '📺 Type',
                value: literature.attributes.type.name,
                inline: true
            },
            {
                name: '🎯 Source',
                value: literature.attributes.source.name,
                inline: true
            },
            {
                name: '🔣 Age Rating',
                value: literature.attributes.tvRating.name,
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
            messageEmbed.addFields({
                name: '📡 Publication',
                value: broadcast,
                inline: true
            })
        }

        if (ran) {
            messageEmbed.addFields({
                name: '📆 Published',
                value: ran,
                inline: true
            })
        }

        messageEmbed.addFields({
                name: '\u200B',
                value: '\u200B',
                inline: true
            },
            {
                name: '📚 Volumes',
                value: `${literature.attributes.volumeCount}`,
                inline: true
            },
            {
                name: '📑 Chapters',
                value: `${literature.attributes.chapterCount}`,
                inline: true
            },
            {
                name: '📃 Pages',
                value: `${literature.attributes.pageCount}`,
                inline: true
            },
            {
                name: '⏱ Duration',
                value: literature.attributes.duration,
                inline: true
            },
            {
                name: '⏱ Duration Total',
                value: literature.attributes.durationTotal,
            }
        )

        if (rating) {
            messageEmbed.addFields({
                name: '⭐️ Rating',
                value: rating
            })
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
     *  Generates a message embed for the given game.
     *
     * @param {} user - user
     * @param {Object<string, *>} game - game
     *
     * @returns {EmbedBuilder}
     */
    #generateEmbedForGame(user, game) {
        const synopsis = game.attributes.synopsis
        const poster = game.attributes.poster
        const banner = game.attributes.banner
        const webURL = `${kurozoraURL}/games/${game.attributes.slug}`
        const copyright = game.attributes.copyright
        const broadcast = this.#getBroadcast(game)
        const ran = this.#getRunningDates(game)
        const runningSeasonEmoji = this.#getRunningSeasonEmoji(game)
        const rating = this.#getRating(game)
        const genres = this.#getGenres(game)
        const themes = this.#getThemes(game)

        const messageEmbed = new EmbedBuilder()
            .setTitle('🕹️ ' + game.attributes.title)
            .setURL(webURL)
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
                value: game.attributes.status.name,
                inline: true
            },
            {
                name: `${runningSeasonEmoji} Season`,
                value: game.attributes.publicationSeason,
                inline: true
            },
            {
                name: '📺 Type',
                value: game.attributes.type.name,
                inline: true
            },
            {
                name: '🎯 Source',
                value: game.attributes.source.name,
                inline: true
            },
            {
                name: '🔣 Age Rating',
                value: game.attributes.tvRating.name,
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
            messageEmbed.addFields({
                name: '📡 Publication',
                value: broadcast,
                inline: true
            })
        }

        if (ran) {
            messageEmbed.addFields({
                name: '📆 Published',
                value: ran,
                inline: true
            })
        }

        messageEmbed.addFields({
                name: '\u200B',
                value: '\u200B',
                inline: true
            },
            {
                name: '🎮 Editions',
                value: `${game.attributes.editionCount}`,
                inline: true
            },
            {
                name: '⏱ Duration',
                value: game.attributes.duration,
                inline: true
            },
            {
                name: '\u200B',
                value: '\u200B',
                inline: true
            },
        )

        if (rating) {
            messageEmbed.addFields({
                name: '⭐️ Rating',
                value: rating
            })
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
     * @returns {EmbedBuilder}
     */
    #generateEmbedForCharacter(user, character) {
        const synopsis = character.attributes.synopsis
        const profile = character.attributes.profile
        const characterStatusEmoji = this.#characterStatusEmoji(character)
        const astrologicalSignEmoji = this.#astrologicalSignEmoji(character)
        const astrologicalSignString = this.#astrologicalSignString(character)
        const bWH = this.#getBWH(character)
        const webURL = `${kurozoraURL}/characters/${character.attributes.slug}`

        const messageEmbed = new EmbedBuilder()
            .setTitle('👤 ' + character.attributes.name)
            .setURL(webURL)
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
     * Get the broadcast of the given media.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {string}
     */
    #getBroadcast(media) {
        let broadcast = ''
        const runDay = media.attributes.airDay ?? media.attributes.publicationDay
        const runTime = media.attributes.airTime ?? media.attributes.publicationTime

        if (runDay) {
            broadcast += `${runDay} `
        }

        if (runTime) {
            broadcast += `at ${runTime}UTC`
        }

        return broadcast
    }

    /**
     * Get the running dates of the given anime.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {string}
     */
    #getRunningDates(media) {
        let ran = ''
        const startedAt = media.attributes.startedAt ?? media.attributes.publishedAt
        const endedAt = media.attributes.endedAt

        if (startedAt) {
            const date = new Date(startedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            ran += `🚀 ${date}`
        }

        if (endedAt) {
            const date = new Date(endedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            ran += `\n╰╍╍╍╍╍╍╍╍╮\n${date} 🏁`
        }

        return ran
    }

    /**
     * Get the air season emoji of the given media.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {string}
     */
    #getRunningSeasonEmoji(media) {
        switch (media.attributes.airSeason ?? media.attributes.publicationSeason) {
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
     * Get the rating of the given media.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {?string}
     */
    #getRating(media) {
        let rating = null
        const stats = media.attributes.stats

        if (stats) {
            rating = `**${stats.ratingAverage}**/5.0 with **${this.abbreviateNumber(stats.ratingCount)}** Ratings`
        }

        return rating
    }

    /**
     * Get the genres of the given media.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {string}
     */
    #getGenres(media) {
        let genres = 'N/A'
        const genresArray = media.attributes.genres ?? []

        if (genresArray.length) {
            genres = genresArray.join(', ')
        }

        return genres
    }

    /**
     * Get the themes of the given media.
     *
     * @param {Object<string, *>} media - media
     *
     * @returns {string}
     */
    #getThemes(media) {
        let themes = 'N/A'
        const themesArray = media.attributes.themes ?? []

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
        let measurements = [bust, waist, hip]
        measurements = measurements.filter(element => element)
        return measurements.join('/')
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
        let regex = /\p{RI}\p{RI}|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?(\u{200D}\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?)+|\p{EPres}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})/gu
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
        let regex = /\p{RI}\p{RI}|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?(\u{200D}\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?)+|\p{EPres}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji}(\p{EMod}+|\u{FE0F}\u{20E3}?|[\u{E0020}-\u{E007E}]+\u{E007F})/gu
        return string?.replace(regex, '')
    }
}

module.exports = {
    KurozoraManager: KurozoraManager
}
