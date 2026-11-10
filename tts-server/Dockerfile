# The gateway: Kokoro (English) runs in this container; VOICEVOX (Japanese) is its own container
# in docker-compose.yml. Builds on linux/arm64 (the Oracle Ampere VM) and linux/amd64.
FROM python:3.12-slim-bookworm

# ffmpeg encodes MP3; espeak-ng is Kokoro's fallback for words outside its dictionary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# CPU-only PyTorch (the CUDA build is several GB). Bump deliberately: it's in the fingerprint.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt \
 && python -m spacy download en_core_web_sm

COPY app.py .
RUN useradd --create-home --uid 1000 app && mkdir -p /models && chown app /models
USER app
ENV HF_HOME=/models/hf
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
