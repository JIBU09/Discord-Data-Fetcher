const { token, clientId, guildId } = require("./config.json");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API = "http://192.168.178.124:5111";
const spotifyStatsAPI = "http://192.168.178.124:6969";

let songData = {};
let customSongData = {};
let spotifyStatsData = [];
let songSpotifyStatsData = {};

// Slash-Command registrieren
const commands = [
    new SlashCommandBuilder()
        .setName("playing")
        .setDescription("Get currently playing song!")
        .toJSON(),
    new SlashCommandBuilder()
        .setName("covers")
        .setDescription("Get covers of currently playing song!")
        .addStringOption(option =>
            option
                .setName("songid")
                .setDescription("Get covers from this song")
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

    if (interaction.commandName === "playing") {
        songData = await getSongData();
        customSongData = await getCustomSongData(songData.songID);
        await interaction.reply(songData.songID);
        return;
    }

    if (interaction.commandName === "covers") {
        await interaction.deferReply();

        const coversSongID = interaction.options.getString("songid");
        const songIdToUse = coversSongID || (songData && songData.songID);

        if (!songIdToUse) {
            const currentSong = await getSongData();

            if (!currentSong?.songID) {
                await interaction.editReply("Ich konnte keinen Song finden.");
                return;
            }

            songData = currentSong;
        }

        const selectedSongData = await getCustomSongData(
            songIdToUse || songData.songID
        );

        const coverUrls = [
            selectedSongData?.custom_cover_url,
            ...(selectedSongData?.alternative_cover_urls || [])
        ].filter(Boolean);

        if (coverUrls.length === 0) {
            await interaction.editReply("Für diesen Song gibt es keine Covers.");
            return;
        }

        // Erste Nachricht
        await interaction.editReply(
            coverUrls.slice(0, 5).join("\n")
        );

        // Weitere Nachrichten mit jeweils maximal 5 URLs
        for (let i = 5; i < coverUrls.length; i += 5) {
            await interaction.followUp(
                coverUrls.slice(i, i + 5).join("\n")
            );
        }
    }

});








async function getSongData() {
    const response = await fetch(`${API}/current-song`);

    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    return data;
}

async function getCustomSongData(songID = songData.songID) {
    const url = `${API}/custom-song/${encodeURIComponent(songID)}`;

    //console.log("CUSTOM API URL:", url);
    //console.log("SONG ID:", songData.songID);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const song = await response.json();

        //console.log("CUSTOM RESPONSE:", song);

        return song;
    } catch (error) {
        console.error("Fetching custom data failed:", error.message);
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