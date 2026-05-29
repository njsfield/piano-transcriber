import pytest
from fastapi.testclient import TestClient
from classify_hands import MidiSeperation
from main import app

client = TestClient(app)

VALID_BODY = {
    "midiEvents": [
        {"id": "1", "pitch": 71, "startMs": 0, "durationMs": 500, "velocity": 80},
        {"id": "2", "pitch": 73, "startMs": 0, "durationMs": 300, "velocity": 80},
    ],
    "chords": [],
    "tempo": 120,
}


def test_returns_200_if_valid_body():
    response = client.post("/classify_hands", json=VALID_BODY)
    assert response.status_code == 200


def test_returns_valid_structure():
    response = client.post("/classify_hands", json=VALID_BODY)
    body = response.json()
    assert "hand_assignment" in body
    assert "hand_confidences" in body


def test_classify_hands_empty_notes_returns_empty_dicts():
    response = client.post(
        "/classify_hands",
        json={"midiEvents": [], "chords": [], "tempo": 120},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["hand_assignment"] == {}
    assert body["hand_confidences"] == {}


def test_classify_hands_missing_tempo_returns_422():
    response = client.post(
        "/classify_hands",
        json={"midiEvents": [], "chords": []},
    )
    assert response.status_code == 422
