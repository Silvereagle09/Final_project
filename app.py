from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import torch
import soundfile as sf
import librosa
import noisereduce as nr
import io, os, time

from faster_whisper import WhisperModel

app = Flask(__name__)
CORS(app)

# -------------------------------------------------------
# Load super-fast model (distilled Small, optimized for CPU)
# -------------------------------------------------------
print("Loading faster-whisper model...")
model = WhisperModel("distil-small.en", device="cpu", compute_type="int8")
print("Model ready!")


# -------------------------------------------------------
# Text cleaning
# -------------------------------------------------------
def clean_text(t):
    t = t.strip()
    if not t:
        return ""

    if t[0].islower():
        t = t[0].upper() + t[1:]

    if t[-1] not in ".!?":
        t += "."

    return t


# -------------------------------------------------------
# Audio preprocessing (noise reduction + resample)
# -------------------------------------------------------
def preprocess_audio(audio: np.ndarray, sr: int):

    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    audio = audio.astype(np.float32)

    # mild noise reduction
    audio = nr.reduce_noise(y=audio, sr=sr, prop_decrease=0.75)

    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        sr = 16000

    return audio, sr


# -------------------------------------------------------
# Main transcription route
# -------------------------------------------------------
@app.route("/transcribe", methods=["POST"])
def transcribe():
    try:
        is_partial = request.headers.get("X-Partial") == "1"
        sr = int(request.headers.get("X-Sample-Rate", "16000"))

        content_type = request.headers.get("Content-Type", "")

        # PCM STREAM (real-time)
        if content_type.startswith("application/octet-stream"):
            raw = request.data
            audio = np.frombuffer(raw, dtype=np.float32)

        # FILE UPLOAD
        else:
            audio_file = request.files.get("audio")
            if not audio_file:
                return jsonify({"error": "No file"}), 400

            data = audio_file.read()

            try:
                audio, sr = sf.read(io.BytesIO(data), dtype="float32")
            except:
                with open("temp.wav", "wb") as f:
                    f.write(data)
                audio, sr = sf.read("temp.wav")
                os.remove("temp.wav")

        # preprocess
        audio, sr = preprocess_audio(audio, sr)

        # Skip empty audio
        if len(audio) < sr * 0.15:
            return jsonify({"text": ""})

        # SPEED OPTIMIZATION
        beam_size = 1 if is_partial else 2
        vad_filter = not is_partial   # only for final

        start = time.time()

        segments, _ = model.transcribe(
            audio,
            beam_size=beam_size,
            vad_filter=vad_filter,
            language="en",
            condition_on_previous_text=not is_partial
        )

        text = " ".join([s.text for s in segments]).strip()

        if not is_partial:
            text = clean_text(text)

        print(f"Transcribed in {time.time() - start:.2f}s -> {text}")

        return jsonify({"text": text})

    except Exception as e:
        print("ERROR:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/")
def home():
    return "Whisper STT backend running!"

if __name__ == "__main__":
    app.run(debug=True)
