const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const axios = require('axios');

const players = []; // Local array to store player information

async function fetchWord() {
    // Local array of fallback words with 5 letters
    const fallbackWords = [
        'apple', 'grape', 'lemon', 'mango', 'peach', 'melon', 'plumb', 'berry',
        'olive', 'cherry', 'pearl', 'quilt', 'bread', 'crown', 'flame', 'flute',
        'flint', 'jewel', 'knife', 'cabin', 'clock', 'dance', 'eagle', 'flask',
        'globe', 'heart', 'house', 'jolly', 'karma', 'lunar', 'magic', 'night',
        'ocean', 'party', 'queen', 'robot', 'snake', 'storm', 'tiger', 'unity',
        'valve', 'wheat', 'xenon', 'yield', 'zebra', 'quark', 'piano', 'daisy',
        'glove', 'honey'
    ];
    try {
        const response = await axios.get('https://api.datamuse.com/words?sp=?????');
        const words = response.data;

        // Filter out words with non-alphabetic characters
        const filteredWords = words.filter(wordObj => /^[a-zA-Z]+$/.test(wordObj.word));

        // Use fallback words if the filtered array is empty
        if (filteredWords.length === 0) {
            const fallbackIndex = Math.floor(Math.random() * fallbackWords.length);
            return fallbackWords[fallbackIndex];
        }

        const index = Math.floor(Math.random() * filteredWords.length);
        return filteredWords[index].word;
    } catch (error) {
        // console.error("Error fetching word:", error);

        // Return a random word from the fallback array in case of error
        const fallbackIndex = Math.floor(Math.random() * fallbackWords.length);
        return fallbackWords[fallbackIndex];
    }
}

async function main() {
    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        cors: {
            origin: true
        }
    });

    app.get('/', (req, res) => {
        res.send('working');
    });

    io.on('connection', async (socket) => {
        const socketId = socket.id;

        // console.log('a user connected: ', socket.id);

        socket.on("username", (msg) => {
            // console.log(msg);
        });

        socket.on("userjoined", async (msg) => {
            const userName = msg.username;
            const roomName = msg.roomId;

            // Find players in the room
            const roomPlayers = players.filter(p => p.room_id === roomName);

            if (roomPlayers.length === 0) {
                io.to(socketId).emit('roomfull', true);
                players.push({ socket_id: socketId, username: userName, room_id: roomName });
                socket.join(roomName);
                socket.to(roomName).emit('message', { username: userName, id: socketId });
                // console.log(`user joined ${userName}, room id ${roomName}`);
            } else if (roomPlayers.length === 1) {
                io.to(socketId).emit('roomfull', true);
                const opponent = roomPlayers[0];
                console.log('opponent: ',opponent);
                const answer = await fetchWord();
                io.to(socketId).emit("solution-word", answer);
                io.to(opponent.socket_id).emit("solution-word", answer);
                io.to(socketId).emit("player-joined", { username: opponent.username, socket_id: opponent.socket_id });
                io.to(opponent.socket_id).emit("player-joined", { username: userName, socket_id: socketId });

                players.push({ socket_id: socketId, username: userName, room_id: roomName, opponent_socket_id: opponent.socket_id });
                players.find(p => p.socket_id === opponent.socket_id).opponent_socket_id = socketId;
                console.log("palyers: ",players)
                socket.join(roomName);
                socket.to(roomName).emit('message', { username: userName, id: socketId });
            } else {
                io.to(socketId).emit('roomfull', false);
                // console.log("couldn't join room full!");
            }
        });

        socket.on("opponents-progress", (data) => {
            console.log('opponent: ', data.to, 'guess: ', data.body);
            io.to(data.to).emit('catch-opponent-progress', data.body);
        });

        socket.on('disconnect', async () => {
            // console.log('Client disconnected:', socket.id);

            const player = players.find(p => p.socket_id === socket.id);
            if (player) {
                players.splice(players.indexOf(player), 1); // Remove player from array
                const opponentSocketId = player.opponent_socket_id;
                if (opponentSocketId) {
                    // console.log('disconnecting!')
                    io.to(opponentSocketId).emit('opponent-disconnected', true);
                    const opponent = players.find(p => p.socket_id === opponentSocketId);
                    if (opponent) {
                        opponent.opponent_socket_id = null;
                    }
                }
            }
        });
    });

    server.listen(process.env.PORT || 8000, () => {
        // console.log('server running at http://localhost:8000');
    });
}

main();
