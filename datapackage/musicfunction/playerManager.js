import { createAudioPlayer, createAudioResource, joinVoiceChannel, demuxProbe, getVoiceConnection } from '@discordjs/voice';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
const ytcookiepath = 'datapackage/musicfunction/ytcookie.json'
const agent = ytdl.createAgent(JSON.parse(fs.readFileSync(ytcookiepath, 'utf-8')));

let playlists = new Map();
const playlistPath = 'datapackage/musicfunction/playlists.json';

// 將播放列表保存到文件的函數
const savePlaylists = () => {
    const jsonObject = Object.fromEntries(playlists.entries());
    fs.writeFileSync(playlistPath, JSON.stringify(jsonObject));
};

// 從文件中加載播放列表的函數
const loadPlaylists = () => {
    if (fs.existsSync(playlistPath)) {
        try {
            const data = fs.readFileSync(playlistPath, 'utf-8');
            playlists = new Map(Object.entries(JSON.parse(data)));
        } catch (err) {
            console.error('解析播放列表失敗:', err);
        }
    }
};

// 從播放列表中移除歌曲的函數
const removeSong = (guildId, songUrl) => {
    const playlist = playlists.get(guildId);
    
    if (!playlist || playlist.length === 0) {
        console.log('播放列表為空，無法刪除歌曲。');
        return; // 不再執行後續代碼，直接返回
    }

    const songIndex = playlist.indexOf(songUrl);
    if (songIndex === -1) {
        console.log('歌曲未在播放列表中找到。');
        return; // 不再執行後續代碼，直接返回
    }

    playlist.splice(songIndex, 1);
    savePlaylists();
};

// 向播放列表中添加歌曲的函數
const addSong = (guildId, songUrl) => {
    const playlist = playlists.get(guildId) || [];
    playlist.push(songUrl);
    playlists.set(guildId, playlist);
    savePlaylists();
};

// 獲取下一首歌曲的函數
const getNextSong = (guildId) => (playlists.get(guildId) || [])[0];

// 獲取整個播放列表的函數
const getPlaylist = (guildId) => playlists.get(guildId) || [];

// 從文件加載播放列表
loadPlaylists();

// 創建全球的音頻播放器
const player = createAudioPlayer();
let songUrl = undefined;

// 創建音頻連接的函數
const createVoiceConnection = (interaction) => {
    try {
        const { guildId, member } = interaction;
        const voiceChannel = member?.voice?.channelId;
        const adapterCreator = interaction.guild.voiceAdapterCreator;

        if (!voiceChannel) {
            throw new Error('您需要先加入一個語音頻道！');
        }

        // 在此處添加獲取用戶信息的例子
        const user = interaction.user;
        console.log(`使用者名稱: ${user.username}, 使用者ID: ${user.id}, 頻道ID: ${voiceChannel}`);
        
        let connection

        connection = joinVoiceChannel({
            channelId: voiceChannel,
            guildId: guildId,
            adapterCreator: adapterCreator,
        });

        return connection;
    } catch (error) {
        console.error(`創建音頻連接時發生錯誤: ${error.message}`);
        // 考慮在這裡給用戶發送錯誤消息
        handleCommandError(interaction, error);
    }
};

// 創建音頻流的函數
const createStream = (songUrl) => {
    // 在此處添加創建音頻流的例子
    console.log(`創建音頻流：${songUrl}`);
    return ytdl(songUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25,agent: agent });
};

// 創建音頻資源的函數
const createResource = async (stream) => {
    const { stream: outputStream, type } = await demuxProbe(stream);
    return createAudioResource(outputStream, { inputType: type, channels: 2, inlineVolume: true });
};

// 播放下一首歌曲的函數
const playNextSong = async (interaction) => {
    try {
        const voiceChannelId = interaction.member?.voice.channelId;
        if (!voiceChannelId) {
            throw new Error('您需要先加入一個語音頻道！');
        }

        const guildId = interaction.guild.id;
        songUrl = getNextSong(guildId);
        
        if (songUrl === undefined) {
            throw new Error('播放列表為空。');
        }

        // 在添加新的錯誤監聽器之前手動移除舊的監聽器
        player.off('error', handlePlayerError);

        let connection = getVoiceConnection(interaction.guild.id);

        if (connection == undefined || !connection) {
            // 加入語音頻道
            console.log('加入語音頻道。');
            let connection
            connection = createVoiceConnection(interaction);
            connection.subscribe(player);
        }

        const stream = createStream(songUrl);
        const resource = await createResource(stream);

        // 在此處添加播放音頻的例子
        console.log(`播放音頻：${songUrl}`);
        player.play(resource);

        // 重新添加新的錯誤監聽器
        player.on('error', handlePlayerError);

        await waitForIdleAndPlayNextSong(interaction);
    } catch (error) {
        console.error('播放下一首歌曲時發生錯誤:', error);
        if (error.message === '播放列表為空。') {
            console.log('播放列表為空，等待新歌曲加入。');
        } else {
            handleCommandError(interaction, error);
        }
    }
};

// 等待播放器空閒並播放下一首歌曲的函數
const waitForIdleAndPlayNextSong = async (interaction) => {
    await new Promise((resolve) => {
        let songUrl2
        player.once('idle', () => {
            console.log('播放器空閒，播放下一首歌曲。');
            if (songUrl !== undefined && player.state.status === 'idle') {
                removeSong(interaction.guild.id, songUrl);
                songUrl2 = getNextSong(interaction.guild.id);
            }
            resolve();
            if (songUrl2 !== undefined){
                playNextSong(interaction);
            } else {
                // 如果播放列表為空，斷開語音連接計時。
                console.log('播放列表為空，斷開語音連接。');
                setTimeout(() => {
                    if (player.state.status === 'idle' && playlists.get(interaction.guild.id).length === 0) {
                        console.log('播放列表為空，斷開語音連接。');
                        stopPlaying(interaction);
                    }else {
                        console.log('忽略。');
                    }
                }, 5 * 60 * 1000); // 300 秒後斷開連接
            }
        });
    });
};

// 跳過到下一首歌曲的函數
const skipToNextSong = async () => {
    if (player.state.status !== 'idle') {
        player.stop();
    }
};

// 停止播放的函數
const stopPlaying = async (interaction) => {
    try {
        console.log(`使用者 ${interaction.user.username} 已停止播放。`);
        if (songUrl !== undefined) {
            removeSong(interaction.guild.id, songUrl);
            songUrl = undefined;
        }
        if (player.state.status !== 'idle') {
            player.stop();
        }
        if (getVoiceConnection(interaction.guild.id) !== null) {
            let connection = getVoiceConnection(interaction.guild.id);
            connection.destroy();
        }

        await console.log('已停止播放。');
    } catch (error) {
        handleCommandError(interaction, error);
    }
};

// 新的錯誤處理函數
const handlePlayerError = (error) => {
    console.error(`音頻播放器錯誤：${error.message}`);
};

// 新的錯誤處理函數
const handleCommandError = (interaction, error) => {
    console.error(`指令錯誤: ${error.message}`);
    // interaction.reply({ content: `指令執行失敗: ${error.message}`, ephemeral: true });
};

// 下载歌曲的函數
const downloadSong = async (interaction, url) => {
    const dir = './downloads';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const audioPath = './downloads/song.wav';  // 定義文件路徑

    // 檢查文件是否存在，如果存在則刪除
    if (fs.existsSync(audioPath)) {
        await fs.promises.unlink(audioPath);
    }

    try {
        await interaction.deferReply();
        const download = ytdl(url, { 
            quality: 'highestaudio',  // 選擇最高音頻質量
            filter: 'audioonly'       // 過濾只下載音頻流
        });
        const writedownload = fs.createWriteStream(audioPath);

        let total = 0;
        let downloaded = 0;
        let lastPercentage = 0;

        download.on('response', res => {
            total = parseInt(res.headers['content-length'], 10);
        });

        download.on('progress', (chunkLength, downloadedChunks, totalChunks) => {
            downloaded += chunkLength;
            if (total) {
                let percentage = (downloaded / total * 100).toFixed(2);
                if (percentage > 100) percentage = 100;
                if (percentage - lastPercentage >= 5) {
                    lastPercentage = percentage;
                    const progressEmbed = new EmbedBuilder()
                        .setTitle('下載進度')
                        .setDescription(`當前下載進度：${percentage}%`);

                    interaction.editReply({ embeds: [progressEmbed] }).catch(console.error);
                }
            }
        });

        download.pipe(writedownload);

        writedownload.on('finish', async () => {
            console.log('下載完成');
            const fileBuffer = await fs.promises.readFile(audioPath);
            const attachment = new AttachmentBuilder(fileBuffer, { name: 'song.wav' });

            const embed = new EmbedBuilder()
                .setTitle('文件下載完成')
                .setDescription('這是您下載的音頻文件');

            await interaction.editReply({ content: '這裡是您的音頻文件:', files: [attachment], embeds: [embed] })
                .catch(error => {
                    console.error(`發送文件時出錯: ${error.message}`);
                });
        });
        
    } catch (error) {
        console.error(`下載音頻時出錯: ${error.message}`);
        await interaction.editReply({ content: `下載音頻失敗: ${error.message}` });
    }
};

export {
    playNextSong,
    skipToNextSong,
    removeSong,
    addSong,
    getNextSong,
    getPlaylist,
    waitForIdleAndPlayNextSong,
    createVoiceConnection,
    stopPlaying,
    downloadSong,
};
