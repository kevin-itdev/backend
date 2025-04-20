console.log('v2025/04/20');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors: { origin: "*", methods: ["GET", "POST"] }});

const url = process.env.WS_URL;
const apiKey = process.env.API_KEY;
const clientId = process.env.CLIENT_ID;
const account = process.env.ACCOUNT;


let ws = [], time = 0, socketProxy, sessionID;
let logon = {
    "MsgType": "Logon",
    "ApiKey": apiKey,
    "Data": {
      "Format" : "VERBOSE",
      "Events" : {
        "SessionId":true,
        "PositionsUpdates" : true,
        "RiskUpdates" : true,
        "EventResponse" : true,
        "OrderStatusEcho" : true
      }
    },
    "ErrorCode": 0
}





//Connect to LightSpeed's API
async function createWebSocket() {

    return new Promise(function(resolve, reject) {
        
        ws = new WebSocket(url);

        ws.on('open', function() {
            console.log('WebSocket connection opened');
            time = new Date().getTime() / 1000;
            ws.send(JSON.stringify(logon)); 
            resolve(); // Resolve the promise when the connection is open
        });

        ws.on('message', function(data) {
            try {
                const info = JSON.parse(data);
                if(info.MsgType != 'OrderSingleStatus' || info.MsgType != 'Heartbeat') {
                    console.log('message:\n', info); // payload received
                    get(info);
                }
            } catch (err) { console.error('Error parsing message:', err); }

            if (time + 12 * 3600 <= new Date().getTime() / 1000) { ws.close(); }
        });

        ws.on('error', function(error) {
            console.error('WebSocket error:', error);
            reject(error); // Reject the promise on error
        });

        ws.on('close', function(code, reason) {
            console.log(`WebSocket connection closed (code: ${code}, reason: ${reason})`);
            setTimeout(createWebSocket, 500); // Reconnect on close
        });
    });
}


(async function() {

    try {
        await createWebSocket();
        console.log('WebSocket connection established before Socket.IO setup.');

        //Connect to our front-end
        io.on('connection', function(socket) {

            socketProxy = socket;
            console.log('a user connected');
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(logon)); // Send logon after WebSocket is open
            } 
            else { console.log('WebSocket not open yet, delaying logon message.'); }

            socket.on('clientMessage', async function(msg) {
                
                try {
                    const parsedData = JSON.parse(msg);
                    console.log('Received client message:', parsedData);
                    await closePositions(parsedData);
                } catch (error) { console.error('Error parsing client message:', error); }
            });

            socket.on('disconnect', function() { console.log('user disconnected'); });
        });

        app.get('/', (req, res) => { res.send('Server is up and running!'); });

        server.listen(3001, () => {
            console.log('listening on port:3001');
        });

    } catch (error) { console.error('Failed to establish WebSocket connection initially:', error); }
})();






async function closePositions(parsedData) {

    let iter = 0;
    for(let i = parsedData.length - 1; i >= 0; i--) {

        let text = parsedData[i].symbol;
        let symbol, callOrPut, strike, month, day, end, quantity = parsedData[i].contracts;
 
        end = text.indexOf(' ');
        symbol = text.substring(0,end);
        text = text.substring(end);
        text = text.replace(/ /g,'');
        month = '20' + text.substring(0,4);
        day = text.substring(4,6);
        callOrPut = (text.substring(6,7) == 'C') ? 'CALL' : 'PUT' ;
        strike = (parseInt(text.substring(7)) / 1000).toString(); // /1000 to eliminate the 3 last zeros
        iter++;


        let order = {
            "ClientID": clientId,
            "Account": account,
            "ApiKey": apiKey,
            "MsgType": "OrderSingle",
            "Symbol": symbol,
            "Side": "SELL",
            "Currency": "USD",
            "OpenClose": "CLOSE",
            "OrderQty": quantity,
            "TimeInForce": "DAY",
            "OrderType": "MARKET",
            "PutOrCall": callOrPut,
            "StrikePrice": strike,
            "MaturityYearMonth": month,
            "MaturityDay": day,
            "SecurityType": "OPTION",
            "ExchangeDestination": "SMART",
            "ClientOrderID": `${new Date().getTime() * 10000 + iter}`,
            "SessionId": sessionID
        }

        // console.log('sending closing order:\n',order);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(order));           
        }                     
    }

    delay(1250);
    ws.send(JSON.stringify(logon)); 
}



function get(info) {

    let positions = [];

    if(info.MsgType == "PositionStatus") {

        for(let i = 0; i <= info.positions.length - 1; i++)
            if(info.positions[i].pos != 0)
                positions.push({ symbol: info.positions[i].sym, contracts: info.positions[i].pos.toFixed(0), profits: info.positions[i].realPl.toFixed(2) },);
        
        console.log("open positions\n",positions);

        if (socketProxy) {
            socketProxy.emit('serverMessage', positions);
        } else {
            console.log('No client connected yet.');
        }
    }

    if(info.MsgType == "Logon") { sessionID = info.SessionId; }
}


async function delay(ms) { return new Promise(resolve => { setTimeout(resolve, ms); }); }

