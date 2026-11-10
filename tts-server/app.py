"""Shino's voice: Kokoro (English) and VOICEVOX (Japanese) behind one small HTTP API.

Runs on the Oracle Cloud VM with docker-compose.yml and is reached only through Cloudflare
Tunnel, by the site's Worker (live LLM replies) and by scripts/chat/render-voice.mjs (curated
clips). Both go through this same code, so a pre-recorded clip and a live reply in the same
language come from the same model, voice, settings, and lexicon.

  POST /v1/speech  {"lang": "en"|"ja", "text": "..."}  -> audio/mpeg
       Authorization: Bearer $TTS_SERVER_TOKEN
       X-Expect-Fingerprint: <fp>  optional; 409 if the voice has changed since then
  GET  /healthz    -> {"en": {"fingerprint"}, "ja": {"fingerprint", "credit"}, "lexicon"}

The fingerprint is a hash of everything that shapes the sound: engine and library versions,
the model and voice files, the settings in voices.json, and that language's lexicon. Clips are
named by it, and the Worker refuses live audio whose fingerprint doesn't match the clips, so
the two never mix.
"""

import asyncio
import hashlib
import hmac
import importlib.metadata
import io
import json
import os
import re
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

CONFIG_DIR = Path(os.environ.get("TTS_CONFIG_DIR", "/config"))
MODEL_DIR = Path(os.environ.get("KOKORO_DIR", "/models/kokoro"))
KOKORO_REPO = "hexgrad/Kokoro-82M"
KOKORO_REVISION = os.environ.get("KOKORO_REVISION", "main")
VOICEVOX_URL = os.environ.get("VOICEVOX_URL", "http://voicevox:50021")
TOKEN = os.environ.get("TTS_SERVER_TOKEN", "")
MAX_TEXT = 400  # characters; the Worker sends one sentence at a time
MAX_WAITING = 6  # requests queued per language before new ones get 503
MP3_BITRATE = "48k"
SAMPLE_RATE = 24000


def log(**entry):
    print(json.dumps(entry, ensure_ascii=False), flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fingerprint(parts: dict) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def version(pkg: str) -> str:
    try:
        return importlib.metadata.version(pkg)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def to_mp3(wav: bytes) -> bytes:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0",
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-f", "mp3", "pipe:1"],
        input=wav, capture_output=True, check=True,
    )
    return out.stdout


class Engine:
    """One language's voice. Synthesis runs one request at a time (2 OCPUs are shared)."""

    fingerprint = ""
    credit = None

    def __init__(self):
        self.lock = threading.Lock()
        self.waiting = 0

    def wav(self, text: str) -> bytes:
        raise NotImplementedError

    def render(self, text: str) -> bytes:
        with self.lock:
            return to_mp3(self.wav(text))


class Kokoro(Engine):
    def __init__(self, cfg: dict, lexicon: dict):
        super().__init__()
        import torch
        from kokoro import KModel, KPipeline

        torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))
        files = fetch_kokoro(["config.json", "kokoro-v1_0.pth", f"voices/{cfg['voice']}.pt"])
        model = KModel(repo_id=KOKORO_REPO, config=str(files[0]), model=str(files[1])).eval()
        self.pipeline = KPipeline(lang_code="a", repo_id=KOKORO_REPO, model=model)
        golds = self.pipeline.g2p.lexicon.golds
        for word, phonemes in lexicon.items():
            for form in {word, word.lower(), word.capitalize()}:
                golds[form] = phonemes
        self.voice = str(files[2])
        self.pipeline.load_voice(self.voice)
        self.speed = float(cfg.get("speed", 1.0))
        self.fingerprint = fingerprint({
            "engine": "kokoro",
            "versions": {p: version(p) for p in ("kokoro", "misaki", "torch", "transformers", "spacy", "en_core_web_sm")},
            "files": {f.name: sha256_file(f) for f in files},
            "config": cfg,
            "lexicon": lexicon,
        })

    def wav(self, text: str) -> bytes:
        chunks = []
        for result in self.pipeline(text, voice=self.voice, speed=self.speed, split_pattern=None):
            audio = getattr(result, "audio", None)
            if audio is None and isinstance(result, tuple):
                audio = result[2]
            if audio is not None:
                chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
        samples = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, samples, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return buf.getvalue()


def fetch_kokoro(names: list[str]) -> list[Path]:
    """Downloads Kokoro's files once into the models volume (pinned by KOKORO_REVISION)."""
    from huggingface_hub import hf_hub_download

    paths = []
    for name in names:
        path = MODEL_DIR / name
        if not path.exists():
            hf_hub_download(KOKORO_REPO, name, revision=KOKORO_REVISION, local_dir=MODEL_DIR)
        paths.append(path)
    return paths


class Voicevox(Engine):
    def __init__(self, cfg: dict, lexicon: dict):
        super().__init__()
        self.http = httpx.Client(base_url=VOICEVOX_URL, timeout=60)
        for _ in range(120):  # the engine takes a while to start
            try:
                engine_version = self.http.get("/version").json()
                break
            except httpx.HTTPError:
                time.sleep(1)
        else:
            raise RuntimeError(f"VOICEVOX engine not reachable at {VOICEVOX_URL}")
        speaker = next((s for s in self.http.get("/speakers").json() if s["name"] == cfg["speaker"]), None)
        if not speaker:
            raise RuntimeError(f"VOICEVOX has no speaker named {cfg['speaker']}")
        style = next((s for s in speaker["styles"] if s["name"] == cfg["style"]), None)
        if not style:
            raise RuntimeError(f"{cfg['speaker']} has no style named {cfg['style']}")
        self.style_id = style["id"]
        # Load the voice now, so the first visitor doesn't wait (and the VM's memory use shows it's in use).
        self.http.post("/initialize_speaker", params={"speaker": self.style_id, "skip_reinit": "true"}).raise_for_status()
        self.params = {k: cfg[k] for k in ("speedScale", "pitchScale", "intonationScale", "volumeScale") if k in cfg}
        self.credit = cfg.get("credit")
        self.readings, self.pattern = compile_readings(lexicon)
        self.fingerprint = fingerprint({
            "engine": "voicevox",
            "version": engine_version,
            "speaker": {"uuid": speaker["speaker_uuid"], "version": speaker.get("version"), "style": self.style_id},
            "config": cfg,
            "lexicon": lexicon,
        })

    def apply_readings(self, text: str) -> str:
        if not self.pattern:
            return text
        return self.pattern.sub(lambda m: self.readings[m.group(0)], text)

    def wav(self, text: str) -> bytes:
        q = self.http.post("/audio_query", params={"text": self.apply_readings(text), "speaker": self.style_id})
        q.raise_for_status()
        query = q.json()
        query.update(self.params)
        query["outputSamplingRate"] = SAMPLE_RATE
        query["outputStereo"] = False
        r = self.http.post("/synthesis", params={"speaker": self.style_id}, json=query)
        r.raise_for_status()
        return r.content


def compile_readings(lexicon: dict):
    """One regex for all readings, longest first; Latin text only matches whole words."""
    if not lexicon:
        return {}, None
    latin = re.compile(r"[A-Za-z0-9]")
    parts = []
    for surface in sorted(lexicon, key=len, reverse=True):
        p = re.escape(surface)
        if latin.match(surface[0]):
            p = r"(?<![A-Za-z0-9])" + p
        if latin.match(surface[-1]):
            p = p + r"(?![A-Za-z0-9])"
        parts.append(p)
    return dict(lexicon), re.compile("|".join(parts))


engines: dict[str, Engine] = {}
errors: dict[str, str] = {}
lexicon_hash = ""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global lexicon_hash
    if not TOKEN:
        raise RuntimeError("TTS_SERVER_TOKEN is not set")
    voices = json.loads((CONFIG_DIR / "voices.json").read_text(encoding="utf-8"))
    lexicon_path = CONFIG_DIR / "lexicon.json"
    lexicon = json.loads(lexicon_path.read_text(encoding="utf-8"))
    lexicon_hash = sha256_file(lexicon_path)
    for lang, cls in (("en", Kokoro), ("ja", Voicevox)):
        try:
            engines[lang] = await run_in_threadpool(cls, voices[lang], lexicon.get(lang, {}))
            log(event="ready", lang=lang, fingerprint=engines[lang].fingerprint)
        except Exception as e:  # one broken language shouldn't take the other down
            errors[lang] = str(e)
            log(event="engine_failed", lang=lang, error=str(e))
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorize(req: Request):
    header = req.headers.get("authorization", "")
    if not hmac.compare_digest(header.encode(), f"Bearer {TOKEN}".encode()):
        raise HTTPException(401, "unauthorized")


@app.get("/healthz")
async def healthz():
    out = {"lexicon": lexicon_hash}
    for lang in ("en", "ja"):
        e = engines.get(lang)
        out[lang] = {"fingerprint": e.fingerprint, "credit": e.credit} if e else {"error": errors.get(lang, "not loaded")}
    return out


@app.post("/v1/speech")
async def speech(req: Request):
    authorize(req)
    try:
        body = await req.json()
    except ValueError:
        raise HTTPException(400, "bad json")
    lang, text = body.get("lang"), body.get("text")
    if lang not in ("en", "ja") or not isinstance(text, str) or not text.strip():
        raise HTTPException(400, "bad request")
    if len(text) > MAX_TEXT:
        raise HTTPException(413, "too long")
    engine = engines.get(lang)
    if not engine:
        raise HTTPException(503, f"{lang} voice unavailable")
    expect = req.headers.get("x-expect-fingerprint")
    if expect and expect != engine.fingerprint:
        raise HTTPException(409, "voice changed")
    if engine.waiting >= MAX_WAITING:
        raise HTTPException(503, "busy")
    engine.waiting += 1
    started = time.monotonic()
    try:
        mp3 = await run_in_threadpool(engine.render, text.strip())
    except Exception as e:
        log(event="synthesis_failed", lang=lang, error=str(e)[:300])
        raise HTTPException(502, "synthesis failed")
    finally:
        engine.waiting -= 1
    log(event="speech", lang=lang, chars=len(text), ms=round((time.monotonic() - started) * 1000), bytes=len(mp3))
    return Response(mp3, media_type="audio/mpeg", headers={"X-Voice-Fingerprint": engine.fingerprint, "Cache-Control": "no-store"})


if __name__ == "__main__":  # local run without Docker: python app.py
    import uvicorn

    asyncio.run(uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8080)).serve())
