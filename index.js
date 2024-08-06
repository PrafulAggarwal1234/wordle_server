const express = require('express');
const { log } = require('node:console');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const request = require('request-promise'); 
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const axios = require('axios');

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
      console.error("Error fetching word:", error);
      
      // Return a random word from the fallback array in case of error
      const fallbackIndex = Math.floor(Math.random() * fallbackWords.length);
      return fallbackWords[fallbackIndex];
    }
}  

async function main(){
    const app = express();
    const server = createServer(app);

    const db = await open({
        filename: 'player.db',
        driver: sqlite3.Database
    })

    const io = new Server(server,{
        cors: {
            origin: 'http://localhost:3000'
        }
    });

    app.get('/', (req, res) => {
        res.sendFile(join(__dirname, 'index.html'));
    });
    
    io.on('connection', async (socket) => {
        const socketId=socket.id;
        
        console.log('a user connected: ',socket.id);
        socket.on("username", (msg)=>{
            console.log(msg);
        })
        
        socket.on("userjoined",async (msg)=>{
            const userName=msg.username;
            const roomName=msg.roomId
            await db.exec(`
            CREATE TABLE IF NOT EXISTS players(
                    socket_id TEXT PRIMARY KEY,
                    username TEXT,
                    room_id INTEGER,
                    opponent_socket_id TEXT
            );`);
            // const count = await db.run(`SELECT COUNT(*) AS user_count FROM players WHERE room_id = ?`,[roomName]);
            // console.log("count: ",count)
            let count=0;
            try {
                // Execute the query and get the result
                const result = await db.get(`SELECT COUNT(*) AS COUNT FROM players WHERE room_id = ?`, [roomName]);
                count=result.COUNT;
            } catch (error) {
            // Handle any errors that occur during the query
                count=0;
                console.error('Error fetching player count:', error);
            }
            if(count==0){
                io.to(socketId).emit('roomfull',true);
                await db.run(`INSERT INTO players (socket_id, username, room_id) VALUES (?, ?, ?);`,[socketId, userName, roomName]);
                socket.join(msg.roomId);
                socket.to(msg.roomId).emit('message', {username: msg.username,id: socket.id});
                console.log(`user joinded ${msg.username}, room id ${msg.roomId}`)
            }
            else if(count===1){
                console.log("inside 1")
                io.to(socketId).emit('roomfull',true);
                const res=await db.get(`SELECT * FROM players WHERE room_id = ?`, [roomName]);
                console.log(res);
                const answer= await fetchWord();
                io.to(socketId).emit("solution-word",answer);
                io.to(res.socket_id).emit("solution-word",answer);
                io.to(socketId).emit("player-joined",{username: res.username,socket_id: res.socket_id});
                io.to(res.socket_id).emit("player-joined",{username: userName, socket_id: socketId});
                await db.run(`INSERT INTO players (socket_id, username, room_id,opponent_socket_id) VALUES (?, ?, ?,?);`,[socketId, userName, roomName,res.socket_id]);
                // await db.run("UPDATE players SET opponent_socket_id = ? WHERE socket_id = ?", [socketId, res.socket_id]);
                await db.run("UPDATE players SET opponent_socket_id = ? WHERE socket_id = ?", [socketId,res.socket_id]);
                socket.join(msg.roomId);
                socket.to(msg.roomId).emit('message', {username: msg.username,id: socket.id});
            }
            else{
                io.to(socketId).emit('roomfull',false);
                console.log("couldn't join room full!")
            }

            // console.log("count: ",count)
            // let space_available=true;
            // if(count>1){
            //     space_available=false;
            // }
            // io.to(socketId).emit('roomfull',space_available);
            // if(space_available){
            //     await db.run(`INSERT INTO players (socket_id, username, room_id) VALUES (?, ?, ?);`,[socketId, userName, roomName]);
            //     socket.join(msg.roomId);
            //     console.log(`${msg.username} User joined room: ${msg.roomId}`);
            //     socket.to(msg.roomId).emit('message', {username: msg.username,id: socket.id});
            //     console.log(`user joinded ${msg.username}, room id ${msg.roomId}`)
            // }
            // else{
            //     console.log("couldn't join room full!")
            // }
        })
        socket.on("oppenents-progress",(data)=>{
            console.log('opponent: ',data.to, 'guess: ',data.body)
            io.to(data.to).emit('catch-opponent-progress',data.body)
        })
        socket.on('disconnect', async () => {
            console.log('Client disconnected:', socket.id);
            const temp_res = await db.get('SELECT opponent_socket_id FROM players WHERE socket_id = ?',[socket.id]);
            const opponentSocketId = temp_res ? temp_res.opponent_socket_id : null;
            io.to(opponentSocketId).emit('opponent-disconnected',true);
            await db.run('DELETE FROM players WHERE socket_id = ?', [socket.id], function(err) {
                if (err) {
                    console.error('Error deleting row:', err.message);
                } else {
                    console.log('Row deleted successfully');
                }
            });
            // You can perform additional cleanup or actions here
        });
    });

    server.listen(process.env.PORT || 8000, () => {
        console.log('server running at http://localhost:8000');
    });

}

main();