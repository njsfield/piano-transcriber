from classify_hands import HandAssignment, HandConfidence, MidiSeperation, ClassifyHands
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


class ClassifyResponse(BaseModel):
    hand_assignment: HandAssignment
    hand_confidences: HandConfidence


type ClassifyRequest = MidiSeperation


@app.post("/classify_hands", response_model=ClassifyResponse)
async def classify_hands(request: ClassifyRequest):
    classify_instance = ClassifyHands(request.midiEvents, request.chords, request.tempo)
    (hand_assignment, hand_confidences) = classify_instance.separate()
    return {"hand_assignment": hand_assignment, "hand_confidences": hand_confidences}
