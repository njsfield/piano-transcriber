import os
import uuid
import tempfile
from typing import List

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


class MidiEvent(BaseModel):
    id: str
    pitch: int
    startMs: float
    durationMs: float
    velocity: int


class NoteConfidence(BaseModel):
    noteId: str
    confidence: float


class TranscribeResponse(BaseModel):
    midi: List[MidiEvent]
    confidences: List[NoteConfidence]


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        from basic_pitch.inference import predict

        _model_output, _midi_data, note_events = predict(tmp_path)

        midi_events: List[MidiEvent] = []
        confidences: List[NoteConfidence] = []

        for note in note_events:
            # note_events format: (start_time_s, end_time_s, pitch, amplitude, pitch_bends)
            start_s, end_s, pitch, amplitude, *_ = note
            note_id = str(uuid.uuid4())
            midi_events.append(MidiEvent(
                id=note_id,
                pitch=int(pitch),
                startMs=float(start_s * 1000),
                durationMs=float((end_s - start_s) * 1000),
                velocity=int(min(127, amplitude * 127)),
            ))
            confidences.append(NoteConfidence(
                noteId=note_id,
                confidence=float(amplitude),
            ))

        return TranscribeResponse(midi=midi_events, confidences=confidences)
    finally:
        os.unlink(tmp_path)
