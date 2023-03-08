const ipcModule = require('node-ipc');
const { writeFileSync } = require("fs");
const { fork } = require("child_process");

let config = require("./config.json");

const ipc = new ipcModule.IPC();

ipc.config.id = "botsmanager";
ipc.config.retry = 1500;
ipc.config.silent = false;
ipc.config.networkPort = 8000;

const setup = () => {
    setInterval(testAliveBots, 5000);
   
    ipc.serveNet(8001, () => 
        {
            ipc.server.on('start', (message, socket) => {
                try {
                    message = JSON.parse(message);
                } catch (error) {
                    console.log("Error while parsing message: " + error);
                    return;
                }

                if(message.bot && message.args) {
                    const bot = config.STARTABLE.find(x => x.name == message.bot);
                    if(!bot) {
                        sendAlert("Bot: " + message.bot + " not found");
                        return;
                    }

                    const botProcess = fork(bot.path, message.args, {
                        detached: true,
                        stdio: "ignore",
                        cwd: bot.path
                    });

                    botProcess.unref();

                    console.log("Bot: " + bot.name + " started with PID: " + botProcess.pid);
                    sendAlert("[Bots Manager] Bot: " + bot.name + " started.");

                    if(config.started[bot.name])
                        config.started[bot.name].push(botProcess.pid);
                    else
                        config.started[bot.name] = [botProcess.pid];

                    saveConfig();
                }
                else {
                    console.log("Invalid message: " + message);
                }
            });

            ipc.server.on('stop', (message, socket) => {
                try {
                    message = JSON.parse(message);
                } catch (error) {
                    console.log("Error while parsing message: " + error);
                    return;
                }

                if(message.bot) {
                    const bot = config.STARTABLE.find(x => x.name == message.bot);
                    if(!bot || !config.started[bot.name]) {
                        sendAlert("[Bots Manager] Bot: " + message.bot + " not found");
                        return;
                    }

                    config.started[bot.name].map(pid => {
                        process.kill(pid, 'SIGINT');
                    });

                    console.log("Bot: " + bot.name + " stopped");
                    sendAlert("[Bots Manager] Bot: " + bot.name + " stopped.");

                    config.started[bot.name] = [];
                    saveConfig();
                }
                else {
                    console.log("Invalid message: " + message);
                }
            });

            ipc.server.on('reload', (message, socket) => {
                config = reloadModule("./config.json");
                console.log("Config reloaded");
                sendAlert("[Bots Manager] Config reloaded");
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