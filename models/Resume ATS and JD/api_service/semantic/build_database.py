"""Builds the ChromaDB resume bank that semantic/engine.py searches.

Run from the service folder with the semantic packages installed:
    pip install -r requirements-semantic.txt
    python -m semantic.build_database

PDFs are read from placed_resume/ (or PLACED_RESUME_PATH) and stored in
resume_db/ (or RESUME_DB_PATH), both in the service folder.
"""
import os
from pypdf import PdfReader
from tqdm import tqdm
from sentence_transformers import SentenceTransformer
import chromadb

# The service folder, one level up, so the data stays where main.py expects it.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def resolve_path(default_relative: str, env_var: str) -> str:
    env_path = os.getenv(env_var)
    if env_path and os.path.isdir(env_path):
        return env_path
    candidate = os.path.join(BASE_DIR, default_relative)
    os.makedirs(candidate, exist_ok=True)
    return candidate

# Initialize ChromaDB client (inside api_service by default)
RESUME_DB_PATH = resolve_path("resume_db", "RESUME_DB_PATH")
chroma_client = chromadb.PersistentClient(path=RESUME_DB_PATH)
collection = chroma_client.get_or_create_collection("resumes")

# Load embedding model
model = SentenceTransformer("all-MiniLM-L6-v2")

def extract_text_from_pdf(path):
    text = ""
    try:
        with open(path, "rb") as f:
            reader = PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() or ""
    except Exception as e:
        print(f"⚠️ Skipping file {os.path.basename(path)} due to error: {e}")
        return None
    return text.strip()

def build_resume_database(folder_path: str = None):
    if folder_path is None:
        folder_path = resolve_path("placed_resume", "PLACED_RESUME_PATH")
    print("🔍 Building resume database...")
    for filename in tqdm(os.listdir(folder_path)):
        if not filename.endswith(".pdf"):
            continue
        path = os.path.join(folder_path, filename)

        text = extract_text_from_pdf(path)
        if not text or len(text) < 100:  # skip empty or short PDFs
            print(f"⚠️ Skipping {filename} — file is empty or unreadable.")
            continue

        try:
            emb = model.encode(text).tolist()
            collection.add(
                documents=[text],
                embeddings=[emb],
                metadatas=[{"filename": filename}],
                ids=[filename]
            )
        except Exception as e:
            print(f"⚠️ Failed to process {filename}: {e}")

    print("✅ Resume database built successfully and stored in ChromaDB!")

if __name__ == "__main__":
    build_resume_database()
