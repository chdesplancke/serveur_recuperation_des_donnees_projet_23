const net = require('net');
const mysql = require('mysql2');
const schedule = require('node-schedule');
let config = require('./config.json');

const esp32AuthKey = "e7e09c4a8c99af1af25682de6633628956118d93a8ce81012fb973d6fc1f9749";
let bdd, clients = [], modules = [];

const server = net.createServer({allowHalfOpen: true}, function (socket) {
    socket.uniqueId = Math.floor(Math.random() * 1000);
    socket.authentification = false;
    socket.setTimeout(5000);
    clients.push(socket);

    console.info('New connection is established. Unique ID = ' + socket.uniqueId);
    console.info(`There are currently ${clients.length} active connection(s)`);
    console.info('Waiting for authentification...');

    socket.on('data', function (data) {
        const textChunk = data.toString('utf8');
        const json = JSON.parse(textChunk);
        if (!getAuth(socket) && json.authKey === esp32AuthKey) {
            if(!modules.includes(json.macaddr)) addModule(json.macaddr);
            console.log("Authentication successful! Client type = ESP32");
            setAuth(socket, true);
            setType(socket, "ESP32");
            socket.setTimeout(0);
            broadcastToESP32(-1, "GET", "all");
        } else if (getAuth(socket)) {
            if (getType(socket) === "ESP32" && json.receiver === -1) {
                updateData(json);
            }
        } else console.log("Unable to authenticate the client with Unique ID = " + socket.uniqueId);
    });

    socket.on('close', function () {
        console.info('A client has disconnected');
        console.info(`There are currently ${clients.length} active connection(s)`);
    });

    socket.on('end', function () {
        deleteClient(socket);
        socket.end();
    });

    socket.on('error', function (err) {
        console.error('Caught flash policy server socket error: ')
        console.error(err.stack)
        deleteClient(socket);
        console.info(`There are currently ${clients.length} active connection(s)`);
    });

    socket.on('timeout', function (err) {
        console.error('The client could not authenticate in time')
        deleteClient(socket);
        socket.end();
    });
});

console.log("Running database...");
bdd = runDatabase();
console.info("Starting server...");
getModules();
server.listen(52275);


function broadcast(message){
    for(let i = 0; i < clients.length; i++){
        clients[i].write(message);
    }
}

function broadcastToESP32(id, type, content){
    const json = {"sender": id, "request": {"type": type, "content": content}};
    for(let i = 0; i < clients.length; i++){
        if(clients[i].type === "ESP32") clients[i].write(JSON.stringify(json));
    }
}

function showClients(){
    clients.forEach(socket => console.log(socket.uniqueId));
}

function deleteClient(socket){
    for(let i = 0; i < clients.length; i++){
        if(clients[i].uniqueId === socket.uniqueId){
            clients.splice(i, 1);
        }
    }
}

function setAuth(socket, bool){
    socket.authentification = bool;
}

function getAuth(socket){
    return socket.authentification;
}

function setType(socket, type){
    socket.type = type;
}

function getType(socket){
    return socket.type;
}
function getUniqueId(socket){
    return socket.uniqueId;
}

function getESP32Count(){
    let count = 0;
    for(let i = 0; i < clients.length; i++){
        if(clients[i].type === "ESP32") count++;
    }
    return count;
}

function runDatabase(){
    return mysql.createPool({
        host: config.database.host,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

}

function addModule(macaddr){
    bdd.query('INSERT INTO modules (mac_address) VALUE (?)', [macaddr],(error, results) => {
        if (error) console.log(error);
    });
}

function getModules(){
    bdd.query('SELECT mac_address FROM modules',(error, results) => {
        if (error) console.log(error);
        else{
            for (let i = 0; i < results.length; i++) {
                modules.push(results[i].mac_address);
            }
        }
    });
}

function updateData(data){
    const date = new Date();
    const sender = data.receiver;
    const dfrobot_sht20 = data.dfrobot_sht20;
    const dfrobot_sen0308 = data.dfrobot_sen0308;
    const adafruit_tsl2591 = data.adafruit_tsl2591;
    console.log(date);
    bdd.query('INSERT INTO dfrobot_sht20 (module_id, date, hum, temp, get_by) ' +
        'VALUE ((SELECT id FROM modules WHERE mac_address = ?),?,?,?,?)',
        [data.macaddr, date, dfrobot_sht20.hum, dfrobot_sht20.temp, sender],
        (error, results) => {
        if (error) console.log(error);
    });
    bdd.query('INSERT INTO dfrobot_sen0308 (module_id, date, hum, get_by) ' +
        'VALUE ((SELECT id FROM modules WHERE mac_address = ?),?,?,?)',
        [data.macaddr, date, dfrobot_sen0308.hum, sender],
        (error, results) => {
            if (error) console.log(error);
    });

    bdd.query('INSERT INTO adafruit_tsl2591 (module_id, date, light, get_by) ' +
        'VALUE ((SELECT id FROM modules WHERE mac_address = ?),?,?,?)',
        [data.macaddr, date, adafruit_tsl2591.light, sender],
        (error, results) => {
            if (error) console.log(error);
        });
    console.log(date);
    console.log("Update done!");
}

schedule.scheduleJob('*/5 * * * *', function(){
    if(getESP32Count() > 0){
        console.log("Running task...");
        broadcastToESP32(-1, "GET", "all");
    }
});