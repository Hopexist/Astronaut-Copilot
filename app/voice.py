from dotenv import load_dotenv
from elevenlabs import ElevenLabs

load_dotenv(".env.local")
load_dotenv(".env")

VOICE_ID = "onwK4e9ZLuTAKqWW03F9"  # Daniel (authoritative)
MODEL_ID = "eleven_flash_v2_5"  # low latency for a live demo


def speak(text: str) -> bytes:
    client = ElevenLabs()  # reads ELEVENLABS_API_KEY from the environment
    audio = client.text_to_speech.convert(
        text=text,
        voice_id=VOICE_ID,
        model_id=MODEL_ID,
        output_format="mp3_44100_128",
    )
    return b"".join(audio)
