FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the embedding model into the image so the first /api/analyze call
# doesn't stall on a ~90MB download.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

EXPOSE 6050

CMD gunicorn main:app --bind 0.0.0.0:${PORT:-6050} --timeout 120
