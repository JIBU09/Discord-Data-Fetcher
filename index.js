const { token, clientId, guildId } = require("./config.json");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Embed, EmbedBuilder, AttachmentBuilder, Component, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const fs = require('fs');
const { type } = require("os");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API = "http://192.168.178.124:5111";
const spotifyStatsAPI = "http://192.168.178.124:6969";


const commands = [
    new SlashCommandBuilder()
        .setName("song")
        .setDescription("Get custom data of a song!")
        .addStringOption(option =>
            option
                .setName("songid")
                .setDescription("Get data from this song")
                .setRequired(false)
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("covers")
        .setDescription("Get covers of a song!")
        .addStringOption(option =>
            option
                .setName("songid")
                .setDescription("Get covers from this song")
                .setRequired(false)
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("lyrics")
        .setDescription("Get lyrics of a song!")
        .addStringOption(option =>
            option
                .setName("songid")
                .setDescription("Get lyrics from this song")
                .setRequired(false)
        )
        .toJSON()
];


const rest = new REST({ version: "10" }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log("App running!");
    } catch (error) {
        console.error(error);
    }
})();


client.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === "song") {
            const songID = interaction.options.getString("songid");
            const currentSong = await getSongData();
            const songIDToUse = songID || currentSong?.songID;

            if (!songIDToUse) {
                await safeReply(interaction, {
                    embeds: [new EmbedBuilder().setTitle("Couldn't find the song").setColor("Red")]
                });
                return;
            }

            const currentCustomSongData = await getCustomSongData(songIDToUse) || {};

            if (songID && (!currentCustomSongData || Object.keys(currentCustomSongData).length === 0)) {
                await safeReply(interaction, {
                    embeds: [new EmbedBuilder().setTitle("No custom data for this song").setColor("Red")]
                });
                return;
            }

            let title;
            let artist;
            let album;
            let coverUrl;
            let footerSongID;

            let customUrl;
            let customLrcLib;
            let ogTitle;
            let altTitles;
            let customArtist;
            let customAlbum;
            let altAlbums;


            let url;



            if (!songID) {
                // Ohne Song ID || Current Playing

                coverUrl = isValidHttpUrl(currentCustomSongData.custom_cover_url) ? currentCustomSongData.custom_cover_url : isValidHttpUrl(currentSong.cover_URL) ? currentSong.cover_URL : null;
                title = safeText(currentSong.title, currentCustomSongData.default_title) || "";
                artist = safeText(currentSong.artist);
                album = safeText(currentSong.album);
                url = `/songs/stats?song=${encodeURIComponent(getSongStatsID(currentSong.title, currentSong.artist))}&range=all_time`;

            } else {
                coverUrl = isValidHttpUrl(currentCustomSongData.custom_cover_url) ? currentCustomSongData.custom_cover_url : null;
                title = safeText(getTitleFromSongID(songIDToUse), currentCustomSongData.default_title) || "";
                artist = safeText(getArtistFromSongID(songIDToUse));
                album = safeText(getAlbumFromSongID(songIDToUse));
                url = `/songs/stats?song=${encodeURIComponent(getSongStatsID(getTitleFromSongID(songIDToUse), getArtistFromSongID(songIDToUse)))}&range=all_time`;
            }


            footerSongID = safeText(songIDToUse);
            customUrl = safeText(currentCustomSongData.custom_url);
            customLrcLib = safeText(currentCustomSongData.custom_lrclib);
            ogTitle = safeText(currentCustomSongData.default_title);
            altTitles = Array.isArray(currentCustomSongData.alternative_titles)
                ? currentCustomSongData.alternative_titles
                    .filter(Boolean)
                    .map(title => `- ${title}`)
                    .join("\n") || "N/A"
                : "N/A";

            customArtist = safeText(currentCustomSongData.custom_artist);
            customAlbum = safeText(currentCustomSongData.custom_album);
            altAlbums = Array.isArray(currentCustomSongData.alternative_albums)
                ? currentCustomSongData.alternative_albums
                    .filter(Boolean)
                    .map(title => `- ${title}`)
                    .join("\n") || "N/A"
                : "N/A";
            customLyrics = safeText(currentCustomSongData.custom_lyrics);
            customSyncedLyrics = safeText(currentCustomSongData.custom_synced_lyrics);


            let statsData = null;
            try {
                const res = await songStatsApiGet(url);
                if (res && res.data) {
                    statsData = res.data;
                }
            } catch (err) {
                console.error("Song stats request failed:", err);
            }

            const songInfoEmbed = new EmbedBuilder()
                .setTitle(title)
                .setColor("Blue")
                .setAuthor({ "name": artist })
                .setFooter({ text: `Song ID: ${footerSongID}` });

            if (currentSong && currentSong.dominant_Color) {
                let [r, g, b] = currentSong.dominant_Color
                songInfoEmbed.setColor(rgb_to_decimal(r, g, b));
            }
            if (coverUrl) {
                songInfoEmbed.setThumbnail(coverUrl);
            }
            addFieldIfValid("Album", album, songInfoEmbed, false);
            addFieldIfValid("Default Title", ogTitle, songInfoEmbed, false);
            addFieldIfValid("Alternative Titles", altTitles, songInfoEmbed, false);
            addFieldIfValid("Custom Genius URL", customUrl, songInfoEmbed, false);
            addFieldIfValid("Custom LRCLIB Search", customLrcLib, songInfoEmbed, false);
            addFieldIfValid("Custom Artist", customArtist, songInfoEmbed, false);
            addFieldIfValid("Custom Album", customAlbum, songInfoEmbed, false);
            addFieldIfValid("Alternative Albums", altAlbums, songInfoEmbed, false);

            if (customLyrics !== "N/A") {
                songInfoEmbed.addFields({ name: "Has Custom Lyrics", value: "", inline: false });
            }
            if (customSyncedLyrics !== "N/A") {
                songInfoEmbed.addFields({ name: "Has Custom Synced Lyrics", value: "", inline: false });
            }

            if (statsData) {
                addFieldIfValid("Plays", statsData.plays + "", songInfoEmbed, true);
                addFieldIfValid("Minutes", Math.floor(statsData.minutes) + "", songInfoEmbed, true);
                addFieldIfValid("Source", statsData.source ? String(statsData.source).toUpperCase() : "UNKNOWN", songInfoEmbed, true);
            }

            /*const copyIDButton = new ButtonBuilder().setCustomId('copy_song_id').setLabel("Copy SongID").setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(copyIDButton);*/

            await safeReply(interaction, { embeds: [songInfoEmbed]/*, components: [row]*/ });
            return;
        }

        if (interaction.commandName === "lyrics") {
            const songID = interaction.options.getString("songid");
            const currentSong = await getSongData();
            const songIDToUse = songID || currentSong?.songID;

            if (!songIDToUse) {
                await safeReply(interaction, {
                    embeds: [new EmbedBuilder().setTitle("Couldn't find the song").setColor("Red")]
                });
                return;
            }

            const currentCustomSongData = await getCustomSongData(songIDToUse) || {};
            let title;
            if (!songID) {
                title = safeText(currentSong.title, currentCustomSongData.default_title) || "";
            } else {
                title = safeText(getTitleFromSongID(songIDToUse), currentCustomSongData.default_title) || "";
            }

            if (songID && (!currentCustomSongData || Object.keys(currentCustomSongData).length === 0)) {
                await safeReply(interaction, {
                    embeds: [new EmbedBuilder().setTitle("No custom data for this song").setColor("Red")]
                });
                return;
            }

            if (currentCustomSongData.custom_synced_lyrics && currentCustomSongData.custom_lyrics) {
                await safeSendLyrics(interaction, currentCustomSongData.custom_synced_lyrics, currentCustomSongData.custom_lyrics, safeText(title + " Lyrics", " Lyrics"));
            } else if (currentCustomSongData.custom_synced_lyrics) {
                await safeSendLyrics(interaction, currentCustomSongData.custom_synced_lyrics, null, safeText(title + " Lyrics", " Lyrics"));
            } else if (currentCustomSongData.custom_lyrics) {
                await safeSendLyrics(interaction, currentCustomSongData.custom_lyrics, null, safeText(title + " Lyrics", " Lyrics"));
            }
        }

        if (interaction.commandName === "covers") {
            await interaction.deferReply();

            const coversSongID = interaction.options.getString("songid");
            const currentSong = coversSongID ? null : await getSongData();
            const songIdToUse = coversSongID || currentSong?.songID;

            if (!songIdToUse) {
                await interaction.editReply("Song not found").catch(() => { });
                return;
            }

            const selectedSongData = await getCustomSongData(songIdToUse) || {};

            if (coversSongID && (!selectedSongData || Object.keys(selectedSongData).length === 0)) {
                await interaction.editReply("No covers were found for this song").catch(() => { });
                return;
            }

            const coverUrls = [
                selectedSongData?.custom_cover_url,
                ...(selectedSongData?.alternative_cover_urls || [])
            ]
                .filter(isValidHttpUrl);

            if (coverUrls.length === 0) {
                await interaction.editReply("No covers were found or this song").catch(() => { });
                return;
            }

            try {
                await interaction.editReply(coverUrls.slice(0, 5).join("\n"));

                for (let i = 5; i < coverUrls.length; i += 5) {
                    await interaction.followUp({ content: coverUrls.slice(i, i + 5).join("\n") });
                }
            } catch (err) {
                console.error("Error while sending cover URLs:", err);
                await interaction.followUp({ content: "Covers couldn't be send correctly. Please try again" }).catch(() => { });
            }
        }
    } catch (error) {
        console.error("Unhandled interaction error:", error);

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setTitle("An unexpected error occurred").setColor("Red")]
                });
            } else {
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle("An unexpected error occurred").setColor("Red")]
                });
            }
        } catch {
            // ignore follow-up reply failures
        }
    }
});


function getTitleFromSongID(songID) {
    if (songID.includes(" - ")) {
        let indexEnd = getNTHOccurence(songID, " - ", 1);
        let songName = songID.slice(0, indexEnd);
        return songName;
    }
    return "N/A";
}

function getArtistFromSongID(songID) {
    if (songID.includes(" - ")) {
        let startIndex = getNTHOccurence(songID, " - ", 1);
        let indexEnd = getNTHOccurence(songID, " - ", 2);
        let songArtist = songID.slice(startIndex + 2, indexEnd);
        return songArtist;
    }
    return "N/A";
}

function getAlbumFromSongID(songID) {
    if (songID.includes(" - ")) {
        let startIndex = getNTHOccurence(songID, " - ", 2);
        let indexEnd = getNTHOccurence(songID, " - ", 3);
        let songAlbum = songID.slice(startIndex + 2, indexEnd);
        return songAlbum;
    }
    return "N/A";
}

function getNTHOccurence(string, subString, i) {
    return string.split(subString, i).join(subString).length;
}

function rgb_to_decimal(r, g, b) {
    return (r << 16) + (g << 8) + b
}


const addFieldIfValid = (name, value, embed, inline) => {
    if (value !== "N/A") {
        embed.addFields({ name, value, inline: inline });
    }
};

async function songStatsApiGet(path) {
    try {
        const res = await fetch(spotifyStatsAPI + path);
        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        return await res.json();
    } catch (error) {
        console.error("Song stats API fetch failed:", error.message);
        return null;
    }
}


function getSongStatsID(title, artists) {
    const artistList = Array.isArray(artists)
        ? artists
        : typeof artists === "string"
            ? [artists]
            : [];

    const artistStr = artistList
        .filter(Boolean)
        .map(a => String(a).toLowerCase().replace(/\s+/g, ""))
        .join(":");

    let s = String(title || "").toLowerCase();

    for (const bracket of ["(", "[", "{"]) {
        const idx = s.indexOf(bracket);
        if (idx !== -1) {
            s = s.slice(0, idx);
        }
    }

    s = s.replace(/\b(feat|ft|featuring|with)\b.*/i, "");
    s = s.replace(/[^a-z0-9 ]/g, "");
    s = s.replace(/\s+/g, " ").trim();

    return `${artistStr}:${s.replace(/\s+/g, "")}`;
}

function isValidHttpUrl(value) {
    if (!value || typeof value !== "string") return false;

    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function safeText(value, fallback = "N/A") {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    return String(value);
}


async function safeReply(interaction, payload) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
            return;
        }

        await interaction.reply(payload);
    } catch (err) {
        console.error("Reply failed:", err);

        try {
            await interaction.channel.send(payload);
        } catch (channelErr) {
            console.error("Fallback channel send failed:", channelErr);
        }
    }
}

async function safeSendLyrics(interaction, synced_lyrics, custom_lyrics, song_title) {
    if (!synced_lyrics || typeof synced_lyrics !== "string" || synced_lyrics.trim() === "") {
        return;
    }

    try {
        const filePath = './synced_lyrics.txt';
        const filePath2 = './lyrics.txt';
        let cutLyrics = synced_lyrics.replace(/<[^>]*>|\[[^\]]*\]/g, "");
        fs.writeFileSync(filePath, synced_lyrics, 'utf8');
        fs.writeFileSync(filePath2, cutLyrics, 'utf8');
        const file = new AttachmentBuilder(filePath);
        const file2 = new AttachmentBuilder(filePath2);

        if (custom_lyrics && typeof custom_lyrics === "string" && custom_lyrics.trim() !== "") {
            const filePath3 = './custom_lyrics.txt';
            fs.writeFileSync(filePath3, custom_lyrics, 'utf8');
            const file3 = new AttachmentBuilder(filePath3);
            if (interaction.channel?.send) {
                await safeReply(interaction, { content: "# " + song_title, files: [file, file2, file3] });
            }
        } else {
            if (interaction.channel?.send) {
                await safeReply(interaction, { content: "# " + song_title, files: [file, file2] });
            }
        }


        fs.unlinkSync(filePath);
    } catch (err) {
        console.error("Error sending text file:", err);
        await safeReply(interaction, {
            embeds: [new EmbedBuilder().setTitle("Couldn't send the file").setColor("Red")]
        });
    }
}


async function getSongData() {
    try {
        const response = await fetch(`${API}/current-song`, {
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Fetching current song failed:", error.message);
        return null;
    }
}

async function getCustomSongData(songID) {
    if (!songID) {
        return null;
    }

    try {
        const url = `${API}/custom-song/${encodeURIComponent(songID)}`;
        const response = await fetch(url, {
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Fetching custom data failed:", error.message);
        return null;
    }
}


client.login(token);