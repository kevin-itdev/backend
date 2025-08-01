const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isBetween = require('dayjs/plugin/isBetween');
const dotenv = require('dotenv');
dotenv.config();
const url = process.env.URL_SILEX;
const userName = process.env.USERNAME_SILEX;
const password = process.env.PASSWORD_SILEX;
const method = {
    INIT : 0,
    ACC_ID : 1,
    OPEN_ORDER : 2,
    GET_ORDERS : 3,
    GET_POSITIONS : 4,
    CLOSE_ORDER : 5,
    CLOSE_POSITION : 6,
    GET_CHAIN : 7
};
const loginMessage = {
 'application_name': 'Postman',
 'application_version': '1.0',
 'domain': 'silexx',
 'password': password,
 'username': userName
};
const activePortfolioUpdateTimers = new WeakMap();
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);


const connectToSilex = async(socket) => {
    
    console.log('timeFilter route', timeFilter());
    const token = await callAPI(method.INIT, loginMessage, null, null);
    const accountId = await callAPI(method.ACC_ID, null, token, null);
    console.log(`token: ${token} accountId: ${accountId}`);

    const optionsList = await callAPI(method.GET_CHAIN,{ underlyingSymbols: ['$SPX'] }, token, null);
    sendSocket(socket, 'optionsTable', optionsList.optionChains[0].optionSeries[0].optionSymbols);
    
    socket.on('fetchOptionChainsByDate', async (data) => {

        console.log('Received a new date. Fetching Option Chains for:', data);
        const year = data.date.substring(2,4);
        const month = data.date.substring(5,7);
        const day = data.date.substring(8,10);
        sendSocket(socket, 'optionsTable', optionsList);

        for(let i = 0; i <= optionsList.optionChains[0].optionSeries.length - 1; i++) 
            if(optionsList.optionChains[0].optionSeries[i].optionSymbols[0].indexOf(year) > 0 && optionsList.optionChains[0].optionSeries[i].optionSymbols[0].indexOf(month) > 0 && optionsList.optionChains[0].optionSeries[i].optionSymbols[0].indexOf(day) > 0) {
                sendSocket(socket, 'optionsTable', optionsList.optionChains[0].optionSeries[i].optionSymbols);
                break;
            }
    });
   
    startRecurringPortfolioUpdates(socket, token, accountId);
    return [token, accountId];
};

const startRecurringPortfolioUpdates = async (socket, token, accountId) => {

    stopRecurringPortfolioUpdates(socket);
    const updateFunc = async () => {
        await updatePortfolio(socket, token, accountId);
        const timeoutId = setTimeout(updateFunc, 30 * 1000);
        activePortfolioUpdateTimers.set(socket, timeoutId);
    };
    await updateFunc();
};

const stopRecurringPortfolioUpdates = (socket) => {
    
    if (activePortfolioUpdateTimers.has(socket)) {
        const timeoutId = activePortfolioUpdateTimers.get(socket);
        clearTimeout(timeoutId);
        activePortfolioUpdateTimers.delete(socket);
        console.log(`Cleared portfolio update timer for socket: ${socket.id}`);
    }
};



const closePosSilex = async(socket, data, token, accountId) => {

    let request, action;
    let specRoute = timeFilter();


    for(let i = data.length - 1; i >= 0; i--) {
       
        if(isNaN(data[i].profits)) { //this is an order, it contains a string Order ID: ...
            
            request = { CurOrdId: data[i].profits.substring(4) };
            await callAPI(method.CLOSE_ORDER, request, token, null);
        }
        else { //position here
            action = (data[i].contracts > 0) ? 'SIDE_SELL' : 'SIDE_BUY' ;
            request = {
                accountId: accountId,
                ord_type: 'ORD_TYPE_MARKET', 
                position_effect: 'POSITION_EFFECT_OPEN',
                // price: parseFloat(data.orderLegs[i].price), 
                price_type: 'PRICE_TYPE_PER_UNIT',
                qty: Math.abs(parseInt(data[i].contracts)),      
                route: specRoute,
                side: action,
                symbol: data[i].symbol,
                tif: 'TIF_DAY' 
            };
            await callAPI(method.CLOSE_POSITION, request, token, null);
        }
         console.log('close request ->',request);            
    }
    await updatePortfolio(socket, token, accountId);
};

const openOrdSilex = async(socket, data, token, accountId) => {

    const type = (data.orderLegs[0]?.price) ? 'ORD_TYPE_LIMIT' : 'ORD_TYPE_MARKET';
    const quantity = parseInt(data.orderLegs[0].quantity);
    const price = parseFloat(data.orderLegs[0]?.price)
    const allRequests = [];
    let symbol, action, subRequest; 
    let specRoute = timeFilter();


    for(let i = 0; i < 4; i++) {
            
        symbol = data.orderLegs[i].symbol;
        action = (data.orderLegs[i].action === 'BUY') ? 'SIDE_BUY' : 'SIDE_SELL';
        subRequest = {
            position_effect : 'POSITION_EFFECT_OPEN',
            ratio : 1,
            side : action,
            symbol : symbol
            }
        allRequests.push(subRequest); 
    }


    let request;
    if(type === 'ORD_TYPE_LIMIT')     
        request = {

            account_id : accountId,
            legs: allRequests,
            ord_type : 'ORD_TYPE_LIMIT',
            price : price,
            price_type : 'PRICE_TYPE_PER_UNIT',
            qty : quantity,
            route : specRoute,
            tif : 'TIF_DAY'
        }
    else 
        request = {

            account_id : accountId,
            legs: allRequests,
            ord_type : 'ORD_TYPE_MARKET',
            price_type : 'PRICE_TYPE_PER_UNIT',
            qty : quantity,
            route : specRoute,
            tif : 'TIF_DAY'
        }
    
    console.log('order request ->', request);    
    await callAPI(method.OPEN_ORDER, request, token, null);
    await updatePortfolio(socket, token, accountId);       
}






function timeFilter() {

    const MARKET_TIMEZONE = 'America/New_York';
    const nowInMarketTime = dayjs().tz(MARKET_TIMEZONE);

    const estStart1 = nowInMarketTime.set('hour', 16).set('minute', 0).set('second', 0).set('millisecond', 0); // 4:00:00.000 PM ET
    const estEnd1   = nowInMarketTime.set('hour', 16).set('minute', 15).set('second', 0).set('millisecond', 0); // 4:15:00.000 PM ET

    const estStart2 = nowInMarketTime.set('hour', 16).set('minute', 15).set('second', 0).set('millisecond', 0); // 4:15:00.000 PM ET
    const estEnd2   = nowInMarketTime.set('hour', 17).set('minute', 0).set('second', 0).set('millisecond', 0);   // 5:00:00.000 PM ET

    let specRoute = 'STAGE';
    if (nowInMarketTime.isBetween(estStart1, estEnd1, null, '[)')) 
        specRoute = 'EDFP OPT4 ML SEN';
    else if (nowInMarketTime.isBetween(estStart2, estEnd2, null, '[)')) 
        specRoute = 'EDF_SPXML_SMART_ETH';
    
    return specRoute;
}







const updatePortfolio = async(socket, token, accountId) => {

    const orders = await callAPI(method.GET_ORDERS, null, token, null);

    // const pos = 0;
    // console.log('orders are', orders);
    // console.log('legs', orders[pos].multiLegOrder.legs);    
    // console.log('orderUpdates', orders[pos].multiLegOrder.orderUpdates);


          
    const positions = await callAPI(method.GET_POSITIONS, null, token, accountId);
    // console.log('positions are', positions);

    const combinedList = [ ...orders, ...positions ]; 

    let updatedList = [], side;
    for(let i = 0; i <= combinedList.length - 1; i++) {

        if(combinedList[i]?.multiLegOrder?.ordType === 'ORD_TYPE_LIMIT') //For multilegs
            for(let j = 0; j <= combinedList[i].multiLegOrder.legs?.length - 1; j++) {

                const status = combinedList[i].multiLegOrder.ordStatus;
                if(status === 'ORD_STATUS_NEW' || status === 'ORD_STATUS_PENDING_NEW' || status === 'ORD_STATUS_STAGED'/* || status === 'ORD_STATUS_REJECTED'*/) {

                    // combinedList[i].multiLegOrder.legs[j].id
                    side = (combinedList[i].multiLegOrder.legs[j].side === 'SIDE_BUY') ? 'BUY' : 'SELL';
                    updatedList.push({ symbol: `${side} ${combinedList[i].multiLegOrder.legs[j].symbol}`, contracts: combinedList[i].multiLegOrder.legs[j].qty, profits: `id: ${combinedList[i].multiLegOrder.legs[j].id}` });
                }

                if(status === 'ORD_STATUS_PARTIALLY_FILLED') {

                    side = (combinedList[i].multiLegOrder.legs[j].side === 'SIDE_BUY') ? 'BUY' : 'SELL';
                    updatedList.push({ symbol: `${side} ${combinedList[i].multiLegOrder.legs[j].symbol}`, contracts: combinedList[i].multiLegOrder.legs[j].leavesQty, profits: `id: ${combinedList[i].multiLegOrder.legs[j].id}` });
                }      
            }

            
        if(combinedList[i]?.realizedPnL != null && combinedList[i]?.netQty != 0) //For positions
            updatedList.push({ symbol: combinedList[i].symbol, contracts: combinedList[i].netQty.toFixed(0), profits: combinedList[i].realizedPnL.toFixed(2) });
    }
    
    // console.log('combinedList',combinedList,combinedList[3]?.security?.option);
    // console.log('updatedList',updatedList);
    sendSocket(socket, 'positionsTable', updatedList);
}





async function callAPI(i, payload, token, accountId) {

    let endPoint, request;
    try {

        if(i == method.INIT) { 
            endPoint = '/application/login'; 
            request = { method: 'POST', headers: {'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        }
        if(i == method.ACC_ID) { 
            endPoint = '/userdata/accounts'; 
            request = { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } } 
        } 
        if(i == method.OPEN_ORDER) { 
            endPoint = '/orders/createmultilegorder';
            request = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) } 
        } 
        if(i == method.GET_ORDERS) {
            endPoint = '/orders';
            request = { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }} 
        }
        if(i == method.GET_POSITIONS) {
            endPoint = `/portfolio/positions?accountIdAndSymbol.accountId=${accountId}`;
            request = { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }} 
        }
        if(i == method.CLOSE_ORDER) {
            endPoint = '/orders/cancelorder';
            request = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) } 
        }
        if(i == method.CLOSE_POSITION) { 
            endPoint = '/orders/createorder';
            request = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) } 
        }      
        if(i == method.GET_CHAIN) { 
            endPoint = '/securities/optionchains';
            request = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) } 
        }     

        const fetchResponse = await fetch(`${url}${endPoint}`, request);
        if (!fetchResponse.ok) {
            console.error(`connect to end point ${endPoint} failed with status: ${fetchResponse.status}`);
            const errorText = await fetchResponse.text();
            console.error('Error body:', errorText);
            throw new Error(`HTTP error! Status: ${fetchResponse.status}`);
        }

        const data = await fetchResponse.json();
        
        if(i == method.INIT) { token = data.token; return token; }
        if(i == method.ACC_ID) { accountId = data?.accounts[0]?.id; return accountId; }
        if(i == method.OPEN_ORDER) { console.log('method.OPEN_ORDER',data); return null; }
        if(i == method.GET_ORDERS) { /*console.log(/*'method.GET_ORDERS',data.orders/*[5].multiLegOrder.orderUpdates);*/ return data.orders; }
        if(i == method.GET_POSITIONS) { /*console.log(/*'method.GET_POSITIONS',data.positions);*/ return data.positions; }
        if(i == method.CLOSE_ORDER) { console.log('method.CLOSE_ORDER',data); return data; }
        if(i == method.CLOSE_POSITION) { console.log('method.CLOSE_POSITION',data); return data; }
        if(i == method.GET_CHAIN) { console.log('method.GET_CHAIN',/*data.optionChains[0].underlying,*//*data.optionChains[0].roots,*//*data.optionChains[0].options,*//*data.optionChains[0].optionSeries*/); return data; }

        
    } catch (error) { console.error('Silex callAPI failed:', error); }
}
// data.orders[5].multiLegOrder.orderUpdates
// data.orders[5].multiLegOrder.legs

const sendSocket = (socket, socketName, data) => {

    if (socket) 
        socket.emit(socketName, data);
    else 
        console.log('No client connected yet.');
}

module.exports = { connectToSilex, closePosSilex, openOrdSilex, stopRecurringPortfolioUpdates };



const req = { //Saif

    account_id: 15298, 
    legs: [
        {position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_BUY', symbol: 'SPXW/250708/6180P'}, 
        {position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_SELL', symbol:'SPXW/250708/6190P'}, 
        {position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_SELL', symbol: 'SPXW/250708/6260C'}, 
        {position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_BUY', symbol: 'SPXW/250708/6270C'}
    ], 
    ord_type: 'ORD_TYPE_LIMIT', 
    price: -3.6, 
    price_type: 'PRICE_TYPE_PER_UNIT', 
    qty: 774.0, 
    route: 'EDFP OPT4 ML SEN', 
    tif: 'TIF_DAY'
}

const request = { //Kevin
  account_id: 2346,
  legs: [
    { position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_BUY', symbol: 'SPXW/250725/3200C' },
    { position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_SELL', symbol: 'SPXW/250725/3200P' },
    { position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_SELL', symbol: 'SPXW/250725/3400C' },
    { position_effect: 'POSITION_EFFECT_OPEN', ratio: 1, side: 'SIDE_BUY', symbol: 'SPXW/250725/3400P' }
  ],
  ord_type: 'ORD_TYPE_LIMIT',
  price: 22,
  price_type: 'PRICE_TYPE_PER_UNIT',
  qty: 10,
  route: 'STAGE',
  tif: 'TIF_DAY'
}
