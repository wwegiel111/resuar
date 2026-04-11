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

# Konfiguracja modelu
system_instruction = "Jesteś ekspertem medycznym AI. Klasyfikuj rany: 'Poparzenie' lub 'Rozcięcie'. Odpowiedz TYLKO JEDNYM SŁOWEM."
model = GenerativeModel("gemini-2.5-flash", system_instruction=system_instruction)

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
        return {"diagnosis": response.text.strip()}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)