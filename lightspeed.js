const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config();
const url = process.env.WS_URL_LIGHTSPEED;
const apiKey = process.env.API_KEY_LIGHTSPEED;
const clientId = process.env.CLIENT_ID_LIGHTSPEED;
const account = process.env.ACCOUNT_LIGHTSPEED;

let sessionID;
let logon = {
    "ClientID": clientId,
    "Account": account,
    "MsgType": "Logon",
    "ApiKey": apiKey,
    "Data": {
      "Format" : "VERBOSE",
      "Events" : { 
        "SessionId" : true, 
        "PositionsUpdates" : true, 
        "RiskUpdates" : true, 
        "EventResponse" : true, 
        "OrderStatusEcho" : true 
        }
    },
    "ErrorCode": 0
}



const connectToLightSpeed = (socket) => {
   
    const ws = new WebSocket(url);

    ws.on('open', () => {
        console.log('WebSocket connection opened');
        ws.send(JSON.stringify(logon)); 
    });
    ws.on('message', (data) => {
        try {
            const info = JSON.parse(data);
            if(info.MsgType != 'OrderSingleStatus' && info.MsgType != 'Heartbeat') {
                console.log(`message(${info.MsgType}):\n`, info); // payload received
                positionData(info, socket);
            }
        } catch (err) { console.error('Error parsing message:', err); }
    });
    ws.on('error', (error) => { console.error('WebSocket error:', error); });
    ws.on('close', (code, reason) => { console.log(`WebSocket connection closed (code: ${code}, reason: ${reason})`); });

    return ws;
}







const closePosLightSpeed = async(ws, parsedData) => {

    let iter = 0, order;
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

        order = {
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
}


const openOrdLightSpeed = async(ws, data) => {

    let iter = 0, order, month, day, type;

    for(let i = 0; i < 4; i++) {
        
        if(data.orderLegs[i].expiration && data.orderLegs[i].strike && data.orderLegs[i].quantity && data.orderLegs[i].symbol) {
            // console.log(data.orderLegs[i]);
            month = data.orderLegs[i].expiration.substring(0,6);
            day = data.orderLegs[i].expiration.substring(6,8);
            type = (data.orderLegs[i].price) ? "LIMIT" : "MARKET";
            iter++;

            if(type == "LIMIT")
                order = {
                "ClientID": clientId,
                "Account": account,
                "ApiKey": apiKey,
                "MsgType": "OrderSingle",
                "Symbol": data.orderLegs[i].symbol,
                "Side": data.orderLegs[i].action,
                "Currency": "USD",
                "OpenClose": "OPEN",
                "OrderQty": data.orderLegs[i].quantity,
                "TimeInForce": "DAY",
                "OrderType": type,
                "Price": data.orderLegs[i].price,
                "PutOrCall": data.orderLegs[i].option,
                "StrikePrice": data.orderLegs[i].strike,
                "MaturityYearMonth": month,
                "MaturityDay": day,
                "SecurityType": "OPTION",
                "ExchangeDestination": "SMART",
                "ClientOrderID": `${new Date().getTime() * 10000 + iter}`,
                "SessionId": sessionID
                }
            else 
                order = {
                "ClientID": clientId,
                "Account": account,
                "ApiKey": apiKey,
                "MsgType": "OrderSingle",
                "Symbol": data.orderLegs[i].symbol,
                "Side": data.orderLegs[i].action,
                "Currency": "USD",
                "OpenClose": "OPEN",
                "OrderQty": data.orderLegs[i].quantity,
                "TimeInForce": "DAY",
                "OrderType": type,
                "PutOrCall": data.orderLegs[i].option,
                "StrikePrice": data.orderLegs[i].strike,
                "MaturityYearMonth": month,
                "MaturityDay": day,
                "SecurityType": "OPTION",
                "ExchangeDestination": "SMART",
                "ClientOrderID": `${new Date().getTime() * 10000 + iter}`,
                "SessionId": sessionID
                }
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(order));           
        }  
    }
}


function positionData(info, socket) {

    let positions = [];

    if(info.MsgType == "PositionStatus") {

        for(let i = 0; i <= info.positions.length - 1; i++)
            if(info.positions[i].pos != 0)
                positions.push({ symbol: info.positions[i].sym, contracts: info.positions[i].pos.toFixed(0), profits: info.positions[i].realPl.toFixed(2) },);
        
        console.log("open positions\n",positions);

        if (socket) {
            socket.emit('positionsTable', positions);
        } else {
            console.log('No client connected yet.');
        }
    }

    if(info.MsgType == "Logon") { sessionID = info.SessionId; }
}


module.exports = { connectToLightSpeed, closePosLightSpeed, openOrdLightSpeed };

