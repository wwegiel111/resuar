import os
import re
import io
import tempfile
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import vertexai
from vertexai.generative_models import GenerativeModel, Part, GenerationConfig, HarmCategory, HarmBlockThreshold, Content
import PIL.Image
from pydantic import BaseModel
from elevenlabs.client import ElevenLabs
from typing import List, Dict


app = FastAPI()

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
elevenlabs_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

# Konfiguracja modelu rozpoznawania obrazen
system_instruction = "Jesteś ekspertem medycznym AI. Klasyfikuj rany: 'Poparzenie' lub 'Rozcięcie'. Odpowiedz TYLKO JEDNYM SŁOWEM."
model = GenerativeModel("gemini-2.5-flash", system_instruction=system_instruction)

#scenariusze
scenario_dict = {
    "Poparzenie": [
        'Run cool water over the area of the burn or soak it in a cool water bath (not ice water). Keep the area under water for at least 5 to 30 minutes. A clean, cold, wet towel will help reduce pain.',
        'Calm and reassure the person.',
        'After flushing or soaking the burn, cover it with a dry, sterile bandage or clean dressing.',
        'Protect the burn from pressure and friction.',
        'Over-the-counter ibuprofen or acetaminophen can help relieve pain and swelling.',
        'Do not give aspirin to children under 12.',
        'Once the skin has cooled, moisturizing lotion containing aloe and an antibiotic also can help.'
    ],
    "Rozcięcie": [
        'Wash your hands with soap or antibacterial cleanser to prevent infection.',
        'Then, wash the cut thoroughly with mild soap and water.',
        'Use direct pressure to stop the bleeding.',
        'Apply antibacterial ointment and a clean bandage that will not stick to the wound.'
    ]
}

#model rozwiniecia rozmowy
system_instruction_model_more_info = "You are an AI emergency medical expert. Analyze the conversation history and clarify the user's query regarding the current first-aid step. Provide a calm, actionable response limited to a maximum of 3 short sentences."
modelMoreInfo = GenerativeModel("gemini-2.5-flash", system_instruction=system_instruction_model_more_info)

class AudioRequest(BaseModel):
    prompt: str

@app.get("/", response_class=HTMLResponse)
def home():
    try:
        with open("index.html", "r", encoding="utf-8") as f:
            html_content = f.read()
        return html_content
    except FileNotFoundError:
        return "BŁĄD: Nie znaleziono pliku index.html na GitHubie."

# --- ANALIZA ZDJĘCIA ---
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
        return {"diagnosis": response.text.strip(), "scenario_array": scenario_dict.get(response.text.strip(), [])}
    except Exception as e:
        return {"error": str(e)}


class ChatRequest(BaseModel):
    history: List[Dict]
@app.post("/more")
async def more(request: ChatRequest):
    print("\n--- START ZAPYTANIA /more ---")
    safety_settings = {
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    }

    try:
        full_history = request.history
        print(f"[LOG] Otrzymano historię z frontendu. Liczba wiadomości: {len(full_history)}")
        
        user_message = full_history[-1]["parts"][0] 
        previous_history_raw = full_history[:-1]

        print(f"[LOG] Nowe pytanie od użytkownika: '{user_message}'")

        formatted_history = []
        for msg in previous_history_raw:
            role = msg["role"]
            text_part = msg["parts"][0]
            formatted_history.append(
                Content(role=role, parts=[Part.from_text(text_part)])
            )
            print(f"[LOG] Załadowano do pamięci AI -> Kto: {role} | Tekst: {text_part[:50]}...")

        print("[LOG] Inicjalizowanie czatu w chat_model...")
        chat = modelMoreInfo.start_chat(history=formatted_history)
        
        print("[LOG] Wysyłanie wiadomości do Gemini...")
        response = chat.send_message(
            user_message,
            generation_config=GenerationConfig(temperature=0.3, max_output_tokens=1000),
            safety_settings=safety_settings 
        )
        
        odpowiedz = response.text.strip()
        print(f"[LOG] Otrzymano odpowiedź od Gemini: '{odpowiedz}'")
        print("--- KONIEC ZAPYTANIA /more ---\n")
        
        return {"text": odpowiedz}
        
    except Exception as e:
        print(f"\n[BŁĄD KRYTYCZNY w /more]: {str(e)}\n")
        return {"error": str(e)}

def get_safe_filename(text: str) -> str:
    pl_chars = "pąćęłńóśźż"
    en_chars = "aceelnoszz"
    text = text.lower()
    for p, e in zip(pl_chars, en_chars):
        text = text.replace(p, e)
    
    text = re.sub(r'[^a-z0-9\s]', '', text)
    filename = text.replace(" ", "_")[:50]
    return f"{filename}.mp3"

# Upewnienie się, że katalog istnieje
RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)


@app.get("/get_audio")
async def get_audio(prompt: str):
    prompt_text = prompt.strip()
    filename = get_safe_filename(prompt_text)
    file_path = os.path.join(RECORDINGS_DIR, filename)

    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        print(f"[CACHE] Wysyłam gotowy plik: {filename}")
        return FileResponse(file_path, media_type="audio/mpeg")

    print(f"[API] Generuję nowy plik dla Apple: {filename}")
    try:
        audio_data_iterator = elevenlabs_client.text_to_speech.stream(
            text=prompt_text,
            voice_id="JBFqnCBsd6RMkjVDRZzb",
            model_id="eleven_multilingual_v2"
        )
        
        temp_file_path = file_path + ".tmp"
        with open(temp_file_path, "wb") as f:
            for chunk in audio_data_iterator:
                f.write(chunk)
        
        os.rename(temp_file_path, file_path)

        print(f"[SUCCESS] Plik gotowy i zapisany: {file_path}")
        return FileResponse(file_path, media_type="audio/mpeg")

    except Exception as e:
        print(f"[ERROR]: {e}")
        return {"error": str(e)}
    

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)