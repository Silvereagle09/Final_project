const API_URL = "http://127.0.0.1:5000/transcribe";

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const partialBox = document.getElementById("partialBox");
const finalBox = document.getElementById("finalBox");
const uploadBtn = document.getElementById("uploadBtn");
const audioFile = document.getElementById("audioFile");
const uploadResult = document.getElementById("uploadResult");
const fileName = document.getElementById("fileName");

let audioContext, processor, stream;
let isRecording = false;
let chunkBuffer = [];
let lastFinal = "";

fileName.innerText = "No file chosen";

audioFile.onchange = () => {
    fileName.innerText = audioFile.files[0]?.name || "No file chosen";
};


// -----------------------------------------------------------------
// UPLOAD TRANSCRIPTION
// -----------------------------------------------------------------
uploadBtn.onclick = async () => {
    if (!audioFile.files[0]) return alert("Choose a file!");

    uploadResult.value = "Processing…";

    let fd = new FormData();
    fd.append("audio", audioFile.files[0]);

    const res = await fetch(API_URL, { method: "POST", body: fd });
    const data = await res.json();

    uploadResult.value = data.text || "(No text detected)";
};


// -----------------------------------------------------------------
// START REALTIME RECORDING
// -----------------------------------------------------------------
startBtn.onclick = async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        audioContext = new AudioContext({ sampleRate: 48000 });
        await audioContext.resume();

        const source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (ev) => {
            if (!isRecording) return;
            chunkBuffer.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
        };

        isRecording = true;
        partialBox.value = "Listening…";
        startBtn.disabled = true;
        stopBtn.disabled = false;

        partialLoop();
        finalLoop();

    } catch (err) {
        console.error(err);
        alert("Mic access denied.");
    }
};


// -----------------------------------------------------------------
// STOP
// -----------------------------------------------------------------
stopBtn.onclick = () => {
    isRecording = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
};


// -----------------------------------------------------------------
// CLEAR
// -----------------------------------------------------------------
clearBtn.onclick = () => {
    partialBox.value = "";
    finalBox.value = "";
    lastFinal = "";
};


// -----------------------------------------------------------------
// PARTIAL (FAST, EVERY 400ms)
// -----------------------------------------------------------------
async function partialLoop() {
    while (isRecording) {
        await wait(400);
        if (chunkBuffer.length === 0) continue;

        let merged = merge(chunkBuffer);
        send(merged, 48000, true);
    }
}


// -----------------------------------------------------------------
// FINAL (EVERY 3 SECONDS)
// -----------------------------------------------------------------
async function finalLoop() {
    while (isRecording) {
        await wait(3000);

        if (chunkBuffer.length === 0) continue;

        let merged = merge(chunkBuffer);
        chunkBuffer = [];

        send(merged, 48000, false);
    }
}


// -----------------------------------------------------------------
function merge(chunks) {
    let length = chunks.reduce((a, b) => a + b.length, 0);
    let out = new Float32Array(length);
    let offset = 0;
    chunks.forEach(b => { out.set(b, offset); offset += b.length; });
    return out;
}

async function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}


// -----------------------------------------------------------------
// SEND TO BACKEND
// -----------------------------------------------------------------
async function send(buffer, sr, isPartial) {
    try {
        const res = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "X-Sample-Rate": sr,
                "X-Partial": isPartial ? "1" : "0"
            },
            body: buffer.buffer
        });

        const data = await res.json();

        if (isPartial) {
            partialBox.value = data.text || "…";
        } else {
            if (data.text && data.text !== lastFinal) {
                lastFinal = data.text;
                finalBox.value += data.text + "\n";
            }
        }

    } catch (e) {
        console.error("Error:", e);
    }
}
