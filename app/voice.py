import os
from io import BytesIO

from dotenv import load_dotenv
from elevenlabs import ElevenLabs

load_dotenv(".env.local")
load_dotenv(".env")

VOICE_ID = "onwK4e9ZLuTAKqWW03F9"  # Daniel (authoritative)
MODEL_ID = "eleven_flash_v2_5"  # low latency for a live demo


def _client() -> ElevenLabs:
    return ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])


def transcribe(audio: bytes) -> str:
    client = _client()
    result = client.speech_to_text.convert(
        file=BytesIO(audio), model_id="scribe_v1", language_code="en"
    )
    return result.text.strip()


def speak(text: str) -> bytes:
    client = _client()
    audio = client.text_to_speech.convert(
        text=text,
        voice_id=VOICE_ID,
        model_id=MODEL_ID,
        output_format="mp3_44100_128",
    )
    return b"".join(audio)
