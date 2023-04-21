const ipcModule = require('node-ipc');
const { writeFileSync } = require("fs");
const { fork } = require("child_process");

let config = require("./config.json");

const ipc = new ipcModule.IPC();

ipc.config.id = "botsmanager";
ipc.config.retry = 1500;
ipc.config.silent = true;
ipc.config.networkPort = 8000;

const setup = () => {
    setInterval(testAliveBots, 5000);
   
    ipc.serveNet(8001, () => 
        {
            ipc.server.on("ping", (message, socket) => {
                ipc.server.emit(socket, "pong", "pong");
            });
        
            ipc.server.on("test-running", (message, socket) => {
                ipc.server.emit(socket, "test-running", "good");
            });

            ipc.server.on('start', (message, socket) => {
                // try {
                //     message = JSON.parse(message);
                // } catch (error) {
                //     console.log("Error while parsing message: " + error);
                //     ipc.server.emit(socket, "started", {success: false});
                //     return;
                // }

                if(message.bot && message.args) {
                    const bot = config.STARTABLE.find(x => x.name == message.bot);
                    if(!bot) {
                        sendAlert("Bot: " + message.bot + " not found");
                        ipc.server.emit(socket, "started", {success: false});
                        return;
                    }

                    if(config.started[bot.name] && bot.singleton && config.started[bot.name].length > 0) {
                        sendAlert("[Bots Manager] Bot: " + bot.name + " already started");
                        ipc.server.emit(socket, "started", {success: false});
                        return;
                    }

                    const botProcess = fork(bot.path, message.args, {
                        detached: true,
                        stdio: "ignore",
                        cwd: bot.path
                    });

                    botProcess.unref();

                    console.log("Bot: " + bot.name + " started with PID: " + botProcess.pid);

                    if(config.started[bot.name])
                        config.started[bot.name].push(botProcess.pid);
                    else
                        config.started[bot.name] = [botProcess.pid];

                    saveConfig();
                    ipc.server.emit(socket, "started", {success: true, newList: getListStartable()});

                    sendAlert("[Bots Manager] Bot: " + bot.name + " started.");
                }
                else {
                    console.log("Invalid message: " + message);
                    ipc.server.emit(socket, "started", {success: false});
                }
            });

            ipc.server.on('stop', (message, socket) => {
                // try {
                //     message = JSON.parse(message);
                // } catch (error) {
                //     console.log("Error while parsing message: " + error);
                //     ipc.server.emit(socket, "stopped", {success: false});
                //     return;
                // }

                if(message.bot) {
                    const bot = config.STARTABLE.find(x => x.name == message.bot);
                    if(!bot || !config.started[bot.name]) {
                        sendAlert("[Bots Manager] Bot: " + message.bot + " not found");
                        ipc.server.emit(socket, "stopped", {success: false});
                        return;
                    }

                    config.started[bot.name].map(pid => {
                        process.kill(pid, 'SIGINT');
                    });

                    console.log("Bot: " + bot.name + " stopped");
                    sendAlert("[Bots Manager] Bot: " + bot.name + " stopped.");

                    config.started[bot.name] = [];
                    saveConfig();

                    ipc.server.emit(socket, "stopped", {success: true, newList: getListStartable()});
                }
                else {
                    console.log("Invalid message: " + message);
                    ipc.server.emit(socket, "stopped", {success: false});
                }
            });

            ipc.server.on('reload', (message, socket) => {
                config = reloadModule("./config.json");
                console.log("Config reloaded");
                sendAlert("[Bots Manager] Config reloaded");
            });

            ipc.server.on("list", (message, socket) => {
                ipc.server.emit(socket, "list", getListStartable());
            });
        }
    );
    ipc.server.start();

    ipc.connectToNet('contactor', () => {
        ipc.of.contactor.on('connect', () => {
            sendAlert("[Bots Manager] Connected to contactor");
            console.log('Connected to contactor');
        });
    });
}

const getListStartable = () => {
    return config.STARTABLE.filter(x => !(config.started[x.name] && config.started[x.name].length > 0 && x.singleton)).map(x => x.name)
}

const testAliveBots = () => {
    for (const [bot, pids] of Object.entries(config.started)) {
        pids.map(pid => { 
            try {
                process.kill(pid, 0);
            } catch (error) {
                config.started[bot] = config.started[bot].filter(x => x != pid);
            }
        });
    }

    saveConfig();
}

const sendAlert = (message) => {
    ipc.of.contactor.emit('alert', JSON.stringify({id: "botsmanager", message: message}));
}

const reloadModule = (moduleName) => {
    delete require.cache[require.resolve(moduleName)]
    console.log('Reloading ' + moduleName + "...");
    return require(moduleName)
}

const saveConfig = () => {
    writeFileSync("./config.json", JSON.stringify(config, null, 4));
}

setup();