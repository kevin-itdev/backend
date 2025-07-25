console.log('v2025/07/10');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
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
const io = new Server(server, {cors: { 
    origin: allowedOrigins.filter(Boolean),
    methods: ["GET", "POST"] 
}});




//Connect to our front-end
io.on('connection', (socket) => {

    console.log('A user connected', socket.id);
    let selectedBroker, lightSpeedWebSocket, silexReconnectTimeoutId, silexToken, silexAccId;

    socket.on('broker', async(brokerName) => {

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

app.get('/', (req, res) => { res.send('Server is up and running!'); });
server.listen(3001, () => { console.log('Listening on port:3001'); });
async function delay(ms) { return new Promise(resolve => { setTimeout(resolve, ms); }); }