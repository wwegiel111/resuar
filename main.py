import os
import json
import tempfile
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import vertexai
from vertexai.generative_models import GenerativeModel, Part, GenerationConfig, HarmCategory, HarmBlockThreshold
import PIL.Image
import io

app = FastAPI()

# 1. CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LOGIKA AUTORYZACJI ---
def setup_vertex_ai():
    creds_json = os.getenv("GOOGLE_CREDS_JSON")
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "rescuar") 
    location = "us-central1"

    if creds_json:
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix=".json") as f:
            f.write(creds_json)
            temp_path = f.name
        
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_path
        vertexai.init(project=project_id, location=location)
        print("Vertex AI zainicjowany pomyślnie.")
    else:
        print("BŁĄD: Brak zmiennej GOOGLE_CREDS_JSON!")

setup_vertex_ai()

# --- KONFIGURACJA MODELI AI ---
# Model 1: Do analizy zdjęć
system_instruction = "Jesteś ekspertem medycznym AI. Klasyfikuj rany: 'Poparzenie' lub 'Rozcięcie'. Odpowiedz TYLKO JEDNYM SŁOWEM."
model = GenerativeModel("gemini-2.5-flash", system_instruction=system_instruction)

# Model 2: Do asystenta głosowego (TUTAJ BYŁ BŁĄD SKŁADNIOWY W TWOIM KODZIE)
voice_instruction = "Jesteś asystentem pierwszej pomocy głosowej. Twoje instrukcje muszą być krótkie (max 2 zdania), spokojne i bardzo konkretne. Użytkownik jest w stresie. Odpowiadaj tak, aby można było cię łatwo zrozumieć ze słuchu."
voice_model = GenerativeModel("gemini-1.5-flash", system_instruction=voice_instruction)

# --- ENDPOINTY (PUNKTY DOSTĘPU) ---

# Strona główna (Frontend)
@app.get("/", response_class=HTMLResponse)
def home():
    try:
        with open("index.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "BŁĄD: Nie znaleziono pliku index.html na GitHubie."

# Analiza zdjęcia
@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    contents = await file.read()
    img = PIL.Image.open(io.BytesIO(contents))
    
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    image_part = Part.from_data(data=img_byte_arr.getvalue(), mime_type="image/jpeg")

    safety_settings = {
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    }

    try:
        response = model.generate_content(
            [image_part, "Skategoryzuj tę ranę."],
            generation_config=GenerationConfig(temperature=0.0, max_output_tokens=200),
            safety_settings=safety_settings
        )
        return {"diagnosis": response.text.strip()}
    except Exception as e:
        return {"error": str(e)}

# Rozmowa z asystentem głosowym (Nowość!)
@app.post("/ask")
async def ask_ai(data: dict):
    pytanie = data.get("pytanie", "")
    rana = data.get("rana", "nieznana")
    
    prompt = f"Użytkownik ma problem: {rana}. Pyta: {pytanie}. Odpowiedz krótko co ma zrobić."
    
    try:
        # Więcej tokenów (150), żeby AI mogło ułożyć kilka pełnych zdań
        response = voice_model.generate_content(
            prompt,
            generation_config=GenerationConfig(temperature=0.2, max_