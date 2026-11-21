#!/usr/bin/env python3
"""Save a full Radar Map Manager config (maps, zones, radar layouts) via the WS command rmm/stream.

Usage: HA_URL=ws://homeassistant.local:8123/api/websocket HA_TOKEN=... python3 tools/rmm_dump.py backup.json

Restore later with the service radar_map_manager.import_config, passing the file's "data" object as json_str.
"""
import asyncio, json, os, sys
import websockets  # pip install websockets

async def main(out):
    url = os.environ.get("HA_URL", "ws://homeassistant.local:8123/api/websocket")
    async with websockets.connect(url, max_size=50_000_000) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": os.environ["HA_TOKEN"]}))
        assert json.loads(await ws.recv())["type"] == "auth_ok", "auth failed"
        await ws.send(json.dumps({"id": 1, "type": "rmm/stream"}))
        while True:  # the first frame is an empty result; the config arrives as an event
            m = json.loads(await asyncio.wait_for(ws.recv(), 20))
            if m.get("type") == "event":
                json.dump(m["event"], open(out, "w"), indent=1)
                print("saved", out, "radars:", list(m["event"]["data"]["radars"]))
                return

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "rmm_backup.json"))
