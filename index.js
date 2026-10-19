const { token, clientId, guildId } = require("./config.json");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Embed, EmbedBuilder, AttachmentBuilder, Component, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { type } = require("os");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API = "http://192.168.178.124:5111";
const TRACKS_API = "http://192.168.178.124:6767/api/tracks/resolve";


const commands = [
    new SlashCommandBuilder()
        .setName("playing")
        .setDescription("Show the currently playing song and its progress")
        .toJSON(),
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
        .addStringOption(option =>
            option
                .setName("type")
                .setDescription("Choose which lyrics to receive")
                .setRequired(false)
                .addChoices(
                    { name: "All lyrics", value: "all" },
                    { name: "Custom lyrics", value: "custom" },
                    { name: "Synced lyrics", value: "synced" },
                    { name: "Lyrics (without timestamps)", value: "lyrics" },
                    { name: "Cleaned lyrics", value: "cleaned" }
                )
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("songdata")
        .setDescription("Get all custom data, lyrics, and covers of a song")
        .addStringOption(option =>
            option
                .setName("songid")
                .setDescription("Song ID to get data from")
                .setRequired(true)
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("cleanlyrics")
        .setDescription("Clean lyrics from section labels and bracketed content")
        .addStringOption(option =>
            option
                .setName("lyrics")
                .setDescription("Lyrics to clean")
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName("file")
                .setDescription("A text file containing lyrics, such as message.txt")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("output")
                .setDescription("Choose how to receive the cleaned lyrics (default: TXT file)")
                .setRequired(false)
                .addChoices(
                    { name: "Messages", value: "messages" },
                    { name: "TXT file", value: "txt" }
                )
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

        if (interaction.commandName === "cleanlyrics") {
            const lyricsInput = interaction.options.getString("lyrics");
            const lyricsFile = interaction.options.getAttachment("file");
            const output = interaction.options.getString("output");

            if (Boolean(lyricsInput) === Boolean(lyricsFile)) {
                await safeReply(interaction, {
                    content: "Bitte gib die Lyrics entweder als Argument oder als Datei an."
                });
                return;
            }

            await interaction.deferReply();

            let lyrics = lyricsInput;
            if (lyricsFile) {
                const response = await fetch(lyricsFile.url);
                if (!response.ok) {
                    throw new Error(`Lyrics attachment download failed: ${response.status} ${response.statusText}`);
                }
                lyrics = await response.text();
            }

            const cleanedLyrics = cleanLyrics(lyrics);
            if (!cleanedLyrics) {
                await interaction.editReply({ content: "Nach dem Bereinigen ist kein Text übrig." });
                return;
            }

            const sendMessages = output === "messages";
            const sendFile = !output || output === "txt";

            if (sendMessages) {
                const chunks = splitLyricsIntoMessages(cleanedLyrics);
                await interaction.editReply({
                    content: chunks[0],
                    allowedMentions: { parse: [] }
                });
                for (const chunk of chunks.slice(1)) {
                    await interaction.followUp({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                }
            }

            if (sendFile) {
                const file = new AttachmentBuilder(Buffer.from(cleanedLyrics, "utf8"), {
                    name: "cleaned-lyrics.txt"
                });
                const payload = { files: [file] };
                if (sendMessages) {
                    await interaction.followUp({
                        ...payload,
                    });
                } else {
                    await interaction.editReply(payload);
                }
            }
            return;
        }

        if (interaction.commandName === "songdata") {
            const songID = interaction.options.getString("songid", true);
            await interaction.deferReply();

            const songData = await getCustomSongData(songID);
            if (!songData || Object.keys(songData).length === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("No custom data for this song").setColor("Red")]
                });
                return;
            }

            const resolvedTrack = await getResolvedTrack(songID);
            const titleFromSongID = getTitleFromSongID(songID);
            const artistFromSongID = getArtistFromSongID(songID);
            const albumFromSongID = getAlbumFromSongID(songID);
            const title = titleFromSongID !== "N/A" ? titleFromSongID : safeText(songData.default_title, songID);
            const artist = artistFromSongID !== "N/A" ? artistFromSongID : safeText(songData.custom_artist);
            const album = albumFromSongID !== "N/A" ? albumFromSongID : safeText(songData.custom_album);
            const coverUrls = [
                songData.custom_cover_url,
                ...(Array.isArray(songData.alternative_cover_urls) ? songData.alternative_cover_urls : [])
            ].filter(isValidHttpUrl);
            const songEmbed = new EmbedBuilder()
                .setTitle(title.slice(0, 256))
                .setColor("Blue")
                .setFooter({ text: formatSongId(songID, resolvedTrack?.id) });

            if (artist !== "N/A") {
                songEmbed.setAuthor({ name: artist.slice(0, 256) });
            }
            if (coverUrls.length > 0) {
                songEmbed.setImage(coverUrls[0]);
            }

            const metadata = [
                ["Album", album],
                ["Default Title", songData.default_title],
                ["Alternative Titles", songData.alternative_titles],
                ["Custom Genius URL", songData.custom_url],
                ["Custom LRCLIB Search", songData.custom_lrclib],
                ["Custom Artist", songData.custom_artist],
                ["Custom Album", songData.custom_album],
                ["Alternative Albums", songData.alternative_albums],
                ["Custom Cover URL", songData.custom_cover_url],
                ["Alternative Cover URLs", songData.alternative_cover_urls]
            ];

            for (const [name, value] of metadata) {
                const formattedValue = Array.isArray(value)
                    ? value.filter(Boolean).join("\n")
                    : safeText(value);
                if (formattedValue !== "N/A" && formattedValue.trim()) {
                    songEmbed.addFields({
                        name,
                        value: formattedValue.slice(0, 1024),
                        inline: false
                    });
                }
            }

            if (coverUrls.length === 0) {
                songEmbed.addFields({ name: "Covers", value: "No custom covers found", inline: false });
            }

            const files = [
                new AttachmentBuilder(Buffer.from(JSON.stringify(songData, null, 2), "utf8"), {
                    name: "custom-song-data.json"
                })
            ];
            const availableLyrics = [];
            if (typeof songData.custom_lyrics === "string" && songData.custom_lyrics.trim()) {
                files.push(new AttachmentBuilder(Buffer.from(songData.custom_lyrics, "utf8"), {
                    name: "custom-lyrics.txt"
                }));
                availableLyrics.push("custom-lyrics.txt");
            }
            if (typeof songData.custom_synced_lyrics === "string" && songData.custom_synced_lyrics.trim()) {
                files.push(new AttachmentBuilder(Buffer.from(songData.custom_synced_lyrics, "utf8"), {
                    name: "custom-synced-lyrics.txt"
                }));
                availableLyrics.push("custom-synced-lyrics.txt");
            }

            songEmbed.addFields({
                name: "Custom Lyrics",
                value: availableLyrics.length > 0 ? availableLyrics.join("\n") : "No custom lyrics found",
                inline: false
            });

            await interaction.editReply({ embeds: [songEmbed], files });

            for (let i = 0; i < coverUrls.length; i += 5) {
                await interaction.followUp({ content: coverUrls.slice(i, i + 5).join("\n") });
            }
            return;
        }

        if (interaction.commandName === "playing") {
            await interaction.deferReply();

            const currentSong = await getSongData();
            const songID = currentSong?.songID;
            if (!songID) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("Couldn't find the currently playing song").setColor("Red")]
                });
                return;
            }

            const [customSongData, liveState, resolvedTrack] = await Promise.all([
                getCustomSongData(songID),
                getLiveState(),
                getResolvedTrack(songID)
            ]);
            const songData = customSongData || {};
            const title = safeText(currentSong.title, safeText(songData.default_title, songID));
            const artist = safeText(currentSong.artist, songData.custom_artist);
            const album = safeText(currentSong.album, songData.custom_album);
            const coverUrl = isValidHttpUrl(songData.custom_cover_url)
                ? songData.custom_cover_url
                : isValidHttpUrl(currentSong.cover_URL)
                    ? currentSong.cover_URL
                    : null;
            const progress = formatProgress(liveState?.progress_ms, resolvedTrack?.durationMs);

            const playingEmbed = new EmbedBuilder()
                .setTitle(title.slice(0, 256))
                .setColor("Blue");

            if (artist !== "N/A") {
                playingEmbed.setAuthor({ name: artist.slice(0, 256) });
            }
            if (currentSong.dominant_Color && Array.isArray(currentSong.dominant_Color)) {
                const [r, g, b] = currentSong.dominant_Color;
                if ([r, g, b].every(Number.isFinite)) {
                    playingEmbed.setColor(rgb_to_decimal(r, g, b));
                }
            }
            if (coverUrl) {
                playingEmbed.setThumbnail(coverUrl);
            }

            addFieldIfValid("Album", album, playingEmbed, false);
            playingEmbed.addFields(
                { name: "Song ID", value: songID.slice(0, 1024), inline: false },
                { name: "Track ID", value: (resolvedTrack?.id ?? "unavailable").slice(0, 1024), inline: false },
                { name: "Progress", value: progress, inline: false }
            );
            addFieldIfValid("Default Title", safeText(songData.default_title), playingEmbed, false);
            addFieldIfValid("Custom Artist", safeText(songData.custom_artist), playingEmbed, false);
            addFieldIfValid("Custom Album", safeText(songData.custom_album), playingEmbed, false);

            await interaction.editReply({ embeds: [playingEmbed] });
            return;
        }

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

            const resolvedTrack = await getResolvedTrack(songIDToUse);
            let title;
            let artist;
            let album;
            let coverUrl;

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


            const songInfoEmbed = new EmbedBuilder()
                .setTitle(title)
                .setColor("Blue")
                .setAuthor({ "name": artist })
                .setFooter({ text: formatSongId(songIDToUse, resolvedTrack?.id) });

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

            /*const copyIDButton = new ButtonBuilder().setCustomId('copy_song_id').setLabel("Copy SongID").setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(copyIDButton);*/

            await safeReply(interaction, { embeds: [songInfoEmbed]/*, components: [row]*/ });
            return;
        }

        if (interaction.commandName === "lyrics") {
            const songID = interaction.options.getString("songid");
            const lyricsType = interaction.options.getString("type") || "all";
            await interaction.deferReply();

            const currentSong = await getSongData();
            const songIDToUse = songID || currentSong?.songID;

            if (!songIDToUse) {
                await interaction.editReply({
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

            let [r, g, b] = currentSong.dominant_Color
            const lyricFiles = buildLyricsFiles(currentCustomSongData, lyricsType);
            const resolvedTrack = await getResolvedTrack(songIDToUse);
            const lyricsEmbed = new EmbedBuilder()
                .setColor(rgb_to_decimal(r, g, b))
                .setTitle(lyricFiles.length === 0
                    ? `No lyrics found for ${title}`.slice(0, 256)
                    : `Found ${lyricFiles.length} ${lyricFiles.length === 1 ? "lyric" : "lyrics"} for ${title}`.slice(0, 256))
                .addFields(
                    { name: "Song ID", value: songIDToUse.slice(0, 1024), inline: false },
                    { name: "Track ID", value: (resolvedTrack?.id ?? "unavailable").slice(0, 1024), inline: false }
                );

            await interaction.editReply({ embeds: [lyricsEmbed] });
            if (lyricFiles.length > 0) {
                await interaction.followUp({
                    files: lyricFiles.map(({ name, content }) =>
                        new AttachmentBuilder(Buffer.from(content, "utf8"), { name })
                    )
                });
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

            const resolvedTrack = await getResolvedTrack(songIdToUse);
            let title;
            if (!coversSongID) {
                title = safeText(currentSong.title, selectedSongData.default_title) || "";
            } else {
                title = safeText(getTitleFromSongID(songIdToUse), selectedSongData.default_title) || "";
            }
            let [r, g, b] = currentSong.dominant_Color
            try {
                const coversEmbed = new EmbedBuilder()
                    .setTitle(`Found ${coverUrls.length} ${coverUrls.length === 1 ? "cover" : "covers"} for ${title}`.slice(0, 256))
                    .setColor(rgb_to_decimal(r, g, b))
                    .addFields(
                        { name: "Song ID", value: songIdToUse.slice(0, 1024), inline: false },
                        { name: "Track ID", value: (resolvedTrack?.id ?? "unavailable").slice(0, 1024), inline: false }
                    );

                await interaction.editReply({ embeds: [coversEmbed] });
                await interaction.followUp({ content: coverUrls.slice(0, 5).join("\n") });

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

async function getResolvedTrack(songID) {
    try {
        const response = await fetch(`${TRACKS_API}?custom_id=${encodeURIComponent(songID)}`, {
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        const trackData = await response.json();
        if (!trackData || typeof trackData !== "object") {
            throw new Error("Track resolve response was not an object");
        }

        return {
            id: trackData.id === undefined || trackData.id === null || trackData.id === ""
                ? null
                : String(trackData.id),
            durationMs: Number.isFinite(Number(trackData.duration_ms)) && Number(trackData.duration_ms) > 0
                ? Number(trackData.duration_ms)
                : null
        };
    } catch (error) {
        console.error(`Resolving track ID for "${songID}" failed:`, error.message);
        return null;
    }
}

async function getLiveState() {
    try {
        const response = await fetch(`${API}/live-state`, {
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Fetching live state failed:", error.message);
        return null;
    }
}

function formatProgress(progressMs, durationMs) {
    if (progressMs === null || progressMs === undefined || progressMs === "" ||
        durationMs === null || durationMs === undefined || durationMs === "") {
        return "Progress unavailable";
    }

    const progress = Number(progressMs);
    const duration = Number(durationMs);
    if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) {
        return "Progress unavailable";
    }

    const clampedProgress = Math.min(Math.max(progress, 0), duration);
    const percentage = Math.floor((clampedProgress / duration) * 100);
    const barLength = 20;
    const filledLength = Math.floor((percentage / 100) * barLength);
    const bar = `${"█".repeat(filledLength)}${"░".repeat(barLength - filledLength)}`;

    return `${bar}\n${formatTime(clampedProgress)} / ${formatTime(duration)}`;
}

function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSongId(songID, resolvedTrackId) {
    return `Song ID: ${songID} | Track ID: ${resolvedTrackId ?? "unavailable"}`;
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

function cleanLyrics(lyrics) {
    return lyrics
        .replace(/\r\n?/g, "\n")
        .replace(/^[ \t]*\[.*?\][ \t\r]*$/gim, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .replace(/ ,/g, ",")
        .replace(/ \./g, ".")
        .replace(/ !/g, "!")
        .replace(/ \?/g, "?")
        .trim();
}

function splitLyricsIntoMessages(lyrics) {
    const chunks = [];
    let remaining = lyrics;

    while (remaining.length > 0) {
        if (remaining.length <= 2000) {
            chunks.push(remaining);
            break;
        }

        let splitAt = remaining.lastIndexOf("\n", 2000);
        if (splitAt <= 0) {
            splitAt = 2000;
        }

        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).replace(/^\n/, "");
    }

    return chunks;
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

function buildLyricsFiles(songData, type) {
    const files = [];
    const syncedLyrics = typeof songData?.custom_synced_lyrics === "string"
        ? songData.custom_synced_lyrics.trim()
        : "";
    const customLyrics = typeof songData?.custom_lyrics === "string"
        ? songData.custom_lyrics.trim()
        : "";
    const plainLyrics = syncedLyrics.replace(/<[^>]*>|\[[^\]]*\]/g, "").trim();
    const cleanedLyrics = syncedLyrics ? cleanLyrics(syncedLyrics) : "";

    if ((type === "all" || type === "synced") && syncedLyrics) {
        files.push({ name: "synced-lyrics.txt", content: syncedLyrics });
    }
    if ((type === "all" || type === "lyrics") && plainLyrics) {
        files.push({ name: "lyrics.txt", content: plainLyrics });
    }
    if (type === "cleaned" && cleanedLyrics) {
        files.push({ name: "cleaned-lyrics.txt", content: cleanedLyrics });
    }
    if ((type === "all" || type === "custom") && customLyrics) {
        files.push({ name: "custom-lyrics.txt", content: customLyrics });
    }

    return files;
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