from classify_hands import (
    ClassifyHands,
    MidiEvent,
    Chord,
    HandAssignment,
    HandConfidence,
)
from pydantic import BaseModel
import json
from typing import List


class _TestData(BaseModel):
    input_notes: List[MidiEvent]
    chords: List[Chord]
    tempo: int
    expected_assignment: HandAssignment
    expected_confidence: HandConfidence
    label: str


def _test_chord_seperation(
    input_notes: List[MidiEvent],
    chords: List[Chord],
    tempo: int,
    expected: tuple[HandAssignment, HandConfidence],
    label: str,
):
    actual = None
    try:
        instance = ClassifyHands(input_notes, chords, tempo)
        actual = instance.separate()
        assert expected == actual
        print(f"PASS - {label}")
    except Exception:
        print(f"FAIL - {label}")
        print(f"--- expected {expected}")
        print(f"--- received {actual}")


def test_basic_lh_sustain_seperation():
    with open("test_classify_hands.json", "r") as f:
        raw_json = f.read()

    results = [_TestData.model_validate(item) for item in json.loads(raw_json)]

    for result in results:
        _test_chord_seperation(
            result.input_notes,
            result.chords,
            result.tempo,
            (result.expected_assignment, result.expected_confidence),
            result.label,
        )
