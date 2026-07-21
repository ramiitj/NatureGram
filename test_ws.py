import asyncio
import websockets
import os
import json

async def test():
    api_key = os.environ.get("GEMINI_API_KEY")
    url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={api_key}"
    try:
        async with websockets.connect(url) as ws:
            print("Connected!")
            setup = {
                "setup": {
                    "model": "models/gemini-2.5-flash-native-audio-latest"
                }
            }
            await ws.send(json.dumps(setup))
            response = await ws.recv()
            print("Response:", response)
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
