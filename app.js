console.log('v2025/08/05');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const { connectToLightSpeed, closePosLightSpeed, openOrdLightSpeed } = require('./lightspeed');
const { connectToSilex, closePosSilex, openOrdSilex, stopRecurringPortfolioUpdates } = require('./silex');

const allowedOrigins = [process.env.LOCAL_ORIGIN, process.env.VERCEL_ORIGIN];
const app = express();
app.use(cors({ 
    origin:  allowedOrigins.filter(Boolean),  
    credentials: true 
    }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {cors: { origin: allowedOrigins.filter(Boolean), methods: ["GET", "POST"] },
    pingInterval: 15000, // Send a ping every 15 seconds
    pingTimeout: 10000,  // Disconnect if no pong received within 10 seconds
});
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const rateLimiter = new RateLimiterMemory({ points: 5, duration: 60 }); // Rate limiter middleware: 5 requests per 60 seconds
let verifyId;


//Connect to our front-end
io.on('connection', (socket) => {

    console.log('A user connected', socket.id);
    let selectedBroker, lightSpeedWebSocket, silexReconnectTimeoutId, silexToken, silexAccId;

    socket.on('login', async (userId) => { //Google login

        console.log(`Google login for user: ${socket.id} and google Id: ${userId}`);

    });


    socket.on('broker', async(brokerName) => {

        if(verifyId == 'kevinbkeena@gmail.com' || verifyId == 'david@spxmgmt.com') {
        } else {
            socket.emit('verifyId', 'Wrong username! Please log in again.');
            socket.disconnect();
        }

        selectedBroker = brokerName;
        console.log(`Seleceted broker: ${selectedBroker}`);
        socket.emit('positionsTable', []); //Reset the positions table when changing brokers
        
        if (lightSpeedWebSocket) {
            await lightSpeedWebSocket.close();
            console.log('Closed previous Lightspeed WebSocket connection.');
            lightSpeedWebSocket = null;
        } 
        
        stopRecurringPortfolioUpdates(socket);
        if (silexReconnectTimeoutId) {
            clearTimeout(silexReconnectTimeoutId);
            console.log('Cleared previous Silex reconnect timeout.');
        }

        if(selectedBroker === 'Lightspeed')       
            lightSpeedWebSocket = connectToLightSpeed(socket);

        else if(selectedBroker === 'Silex') {
            [silexToken, silexAccId] = await connectToSilex(socket); 
            silexReconnectTimeoutId = setTimeout(async() => { [silexToken, silexAccId] = await connectToSilex(socket); }, 50 * 60 * 1000);
        } 
    });


    socket.on('sendOrder', async (data) => {

        try {          
            console.log('sendOrder message:', data);          
            if(selectedBroker === 'Lightspeed') {
                await openOrdLightSpeed(lightSpeedWebSocket, data);
                await lightSpeedWebSocket.close();
                lightSpeedWebSocket = null;
                await delay(1000);
                lightSpeedWebSocket = connectToLightSpeed(socket);
            }

            else if(selectedBroker === 'Silex') 
                await openOrdSilex(socket, data, silexToken, silexAccId);
            
        } catch (error) { console.error('Error parsing client message:', error); }
    });


    socket.on('closePositions', async (data) => {
        
        try {
            const parsedData = JSON.parse(data);
            console.log('closePositions message:', parsedData);
            
            if(selectedBroker === 'Lightspeed') {
                await closePosLightSpeed(lightSpeedWebSocket, parsedData);
                await lightSpeedWebSocket.close();
                lightSpeedWebSocket = null;
                await delay(1000);
                lightSpeedWebSocket = connectToLightSpeed(socket);
            }

            else if(selectedBroker === 'Silex') 
                await closePosSilex(socket, parsedData, silexToken, silexAccId);

        } catch (error) { console.error('Error parsing client message:', error); }
    });


    socket.on('disconnect', async() => { 
        console.log('User disconnected');

        if (lightSpeedWebSocket) {
            await lightSpeedWebSocket.close();
            console.log('Closed previous Lightspeed WebSocket connection.');
            lightSpeedWebSocket = null;
        }  
        if (silexReconnectTimeoutId)  // Clear any existing timeout
            clearTimeout(silexReconnectTimeoutId);
    });
});


async function verifyGoogleToken(credential) {
    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const userId = payload.sub;
        const email = payload.email;
        const name = payload.name;

        return { userId, email, name };
    } catch (error) {
        console.error('Google token verification failed:', error);
        return null;
    }
}

app.post('/api/google-login', async (req, res) => {
    const { credential } = req.body;

    if (!credential)
        return res.status(400).json({ message: 'No credential provided' });

    const userData = await verifyGoogleToken(credential);
    console.log('userData', userData);
    verifyId = userData.email;
    if (userData)
        return res.json({ message: 'Google login successful', user: userData });
    else {
        return res.status(401).json({ message: 'Invalid Google token' });
    }
});



app.get('/', (req, res) => { res.send('Server is up and running!'); });
server.listen(3001, () => { console.log('Listening on port:3001'); });
async function delay(ms) { return new Promise(resolve => { setTimeout(resolve, ms); }); }