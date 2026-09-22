const os = require('os');

function getRamUsage() {
    const total = os.totalmem() / 1024 / 1024 / 1024;
    const used = process.memoryUsage().heapUsed / 1024 / 1024 / 1024;
    return `${used.toFixed(2)}GB / ${total.toFixed(2)}GB`;
}

function getCpuModel() {
    return os.cpus()[0].model;
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

function getDate() {
    return new Date().toLocaleDateString('en-GB');
}

function getTime() {
    return new Date().toLocaleTimeString('en-GB');
}

function getPlatform() {
    return `${os.type()} ${os.release()}`;
}

module.exports = { getRamUsage, getCpuModel, formatUptime, getDate, getTime, getPlatform };