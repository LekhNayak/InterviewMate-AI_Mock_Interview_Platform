FROM python:3.11-slim

WORKDIR /app

# The full build: the light engine plus the optional semantic engine (PyTorch,
# sentence-transformers, ChromaDB). Vercel uses requirements.txt only.
COPY requirements.txt requirements-semantic.txt ./
# CPU-only PyTorch first, so sentence-transformers does not pull the CUDA build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements-semantic.txt

# Bake the embedding model into the image so the first analysis does not wait for a download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

ENV ATS_SEMANTIC=1
EXPOSE 6050

CMD gunicorn main:app --bind 0.0.0.0:${PORT:-6050} --timeout 120
