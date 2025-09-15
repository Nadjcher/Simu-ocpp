// perf-runner/recorder.js
const fs = require("fs");
const path = require("path");

const recordingsDir = path.join(__dirname, "tnr");
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir);

let currentRecording = null;

function startRecording(name) {
    currentRecording = {
        name,
        startedAt: new Date().toISOString(),
        events: [],
    };
    console.log("[TNR] Recording started:", name);
    return currentRecording;
}

function stopRecording(id) {
    if (!currentRecording) {
        throw new Error("No recording active");
    }
    const durationMs = Date.now() - new Date(currentRecording.startedAt).getTime();
    const filePath = path.join(recordingsDir, `${id}.json`);
    fs.writeFileSync(
        filePath,
        JSON.stringify({ ...currentRecording, durationMs }, null, 2)
    );
    console.log("[TNR] Recording stopped:", id, "saved to", filePath);
    currentRecording = null;
    return { ok: true, id };
}

function recordEvent(evt) {
    if (currentRecording) {
        currentRecording.events.push({
            ts: Date.now(),
            ...evt,
        });
    }
}

function listRecordings() {
    return fs.readdirSync(recordingsDir).filter(f => f.endsWith(".json"));
}

function loadRecording(id) {
    const filePath = path.join(recordingsDir, id);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
    startRecording,
    stopRecording,
    recordEvent,
    listRecordings,
    loadRecording,
};
