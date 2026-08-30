const { token, clientId, guildId } = require("./config.json");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Embed, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const fs = require('fs');

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



        if (!songID) {
            // Ohne Song ID || Current Playing
            coverUrl = isValidHttpUrl(currentCustomSongData.custom_cover_url) ? currentCustomSongData.custom_cover_url : isValidHttpUrl(currentSong.cover_URL) ? currentSong.cover_URL : null;
            title = safeText(currentSong.title, currentCustomSongData.default_title) || "";
            artist = safeText(currentSong.artist);
            album = safeText(currentSong.album);

        } else {
            coverUrl = isValidHttpUrl(currentCustomSongData.custom_cover_url) ? currentCustomSongData.custom_cover_url : null;
            title = safeText(getTitleFromSongID(songIDToUse), currentCustomSongData.default_title) || "";
            artist = safeText(getArtistFromSongID(songIDToUse));
            album = safeText(getAlbumFromSongID(songIDToUse));
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





        const songInfoEmbed = new EmbedBuilder()
            .setTitle(title)
            .setColor("Blue")
            .setAuthor({ "name": artist })
            .setFooter({ text: `Song ID: ${footerSongID}` });

        if (currentSong.dominant_Color) {
            let [r, g, b] = currentSong.dominant_Color
            songInfoEmbed.setColor(rgb_to_decimal(r, g, b));
        }
        if (coverUrl) {
            songInfoEmbed.setThumbnail(coverUrl);
        }

        addFieldIfValid("Default Title", ogTitle, songInfoEmbed);
        addFieldIfValid("Album", album, songInfoEmbed);
        addFieldIfValid("Custom Genius URL", customUrl, songInfoEmbed);
        addFieldIfValid("Custom LRCLIB Search", customLrcLib, songInfoEmbed);
        addFieldIfValid("Alternative Titles", altTitles, songInfoEmbed);
        addFieldIfValid("Custom Artist", customArtist, songInfoEmbed);
        addFieldIfValid("Custom Album", customAlbum, songInfoEmbed);
        addFieldIfValid("Alternative Albums", altAlbums, songInfoEmbed);



        await safeReply(interaction, { embeds: [songInfoEmbed] });

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
        await interaction.reply("# Synced Lyrics");
        if (currentCustomSongData.custom_synced_lyrics) {
            await safeSendLyrics(interaction, currentCustomSongData.custom_synced_lyrics);
        }
    }

    if (interaction.commandName === "covers") {
        await interaction.deferReply();

        const coversSongID = interaction.options.getString("songid");
        const currentSong = coversSongID ? null : await getSongData();
        const songIdToUse = coversSongID || currentSong?.songID;

        if (!songIdToUse) {
            await interaction.editReply("Ich konnte keinen Song finden.").catch(() => { });
            return;
        }

        const selectedSongData = await getCustomSongData(songIdToUse) || {};
        const coverUrls = [
            selectedSongData?.custom_cover_url,
            ...(selectedSongData?.alternative_cover_urls || [])
        ]
            .filter(isValidHttpUrl);

        if (coverUrls.length === 0) {
            await interaction.editReply("Für diesen Song gibt es keine Covers.").catch(() => { });
            return;
        }

        try {
            await interaction.editReply(coverUrls.slice(0, 5).join("\n"));

            for (let i = 5; i < coverUrls.length; i += 5) {
                await interaction.followUp({ content: coverUrls.slice(i, i + 5).join("\n") });
            }
        } catch (err) {
            console.error("Error while sending cover URLs:", err);
            await interaction.followUp({ content: "Die Covers konnten nicht sauber gesendet werden. Bitte versuche es erneut." }).catch(() => { });
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


const addFieldIfValid = (name, value, embed) => {
    if (value !== "N/A") {
        embed.addFields({ name, value, inline: false });
    }
};



function getSongStatsID(title, artists) {
    const artistStr = artists
        .map(a => a.toLowerCase().replace(/\s+/g, ""))
        .join(":");

    let s = title.toLowerCase();

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

async function safeSendLyrics(interaction, lyrics) {
    if (!lyrics || typeof lyrics !== "string" || lyrics.trim() === "") {
        return;
    }

    try {
        const filePath = './synced_lyrics.txt';
        fs.writeFileSync(filePath, lyrics, 'utf8');
        const file = new AttachmentBuilder(filePath);

        if (interaction.channel?.send) {
            await interaction.channel.send({ message: "# Synced Lyrics", files: [file] });
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

async function getSpotifyStatsData() {
    const url = `${spotifyStatsAPI}/songs/top?limit=5&sort=plays`

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
            return;
        }

        const topSongs = await response.json();

        //console.log(topSongs.data);

        return topSongs.data;
    } catch (error) {
        console.error("Fetching custom data failed:", error.message);
    }
}

async function getSpotifySongStatsData(song_id) {
    if (!song_id) {
        return null;
    }

    const url = `${spotifyStatsAPI}/songs/stats?song=${encodeURIComponent(song_id)}`

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
            return;
        }

        const songStats = await response.json();

        //console.log(topSongs.data);

        return songStats.data;
    } catch (error) {
        console.error("Fetching custom data failed:", error.message);
    }
}



client.login(token);