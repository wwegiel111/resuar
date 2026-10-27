"""
RescuAR Backend — AI-Powered First Aid Assistant
=================================================
Security & Infrastructure:
  1. File validation on /analyze (MIME, extension, size)
  2. Secure JSON credentials parsing from env vars
  3. Rate limiting on AI endpoints (slowapi)

Core Value Proposition:
  4. Severity detection (mild / moderate / severe)
  5. Expanded wound types (8 categories with severity-specific scenarios)
  6. Fixed mock audio (returns real silent MP3 instead of JSON)
"""

import os
import re
import io
import json
import hashlib
from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import PIL.Image
from pydantic import BaseModel
from typing import List, Dict

# ============================================================================
# [3] RATE LIMITING — using slowapi
# ============================================================================
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    RATE_LIMIT_AVAILABLE = True
except ImportError:
    RATE_LIMIT_AVAILABLE = False
    print("⚠️  slowapi not installed — rate limiting disabled")

# Try to import Google and ElevenLabs, but allow graceful fallback
try:
    from google import genai
    from google.genai import types
    from google.oauth2 import service_account
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False
    print("⚠️  Google Cloud AI not available - using mock mode")

try:
    from elevenlabs.client import ElevenLabs
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False
    print("⚠️  ElevenLabs not available - using mock mode")


# ============================================================================
# APP INITIALIZATION
# ============================================================================
app = FastAPI(title="RescuAR API", version="2.0.0")

# Rate limiter setup
if RATE_LIMIT_AVAILABLE:
    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
else:
    # No-op decorator when slowapi is not available
    class FakeLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator
    limiter = FakeLimiter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    """
    Without explicit caching headers browsers cache JS heuristically and may
    skip asking the server for hours. no-cache makes them revalidate every
    time (a cheap 304 when unchanged), so edits show up without a hard refresh.
    """
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path in ("/", "/phone"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Mount static assets
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def compute_asset_version() -> str:
    """Hash of all files in static/ — changes whenever any CSS/JS file changes."""
    digest = hashlib.sha1()
    for root, dirs, files in os.walk(STATIC_DIR):
        dirs.sort()
        for name in sorted(files):
            path = os.path.join(root, name)
            digest.update(os.path.relpath(path, STATIC_DIR).encode("utf-8"))
            with open(path, "rb") as f:
                digest.update(f.read())
    return digest.hexdigest()[:12]


# index.html is served with asset URLs under /static/<version>/ (see home()).
# JS modules import each other by relative path, so every module gets a new
# URL whenever any asset changes — a browser can't mix modules cached from an
# older deploy with new ones (old cache entries are simply never requested).
ASSET_VERSION = compute_asset_version() if os.path.isdir(STATIC_DIR) else "dev"

if os.path.isdir(STATIC_DIR):
    # The versioned mount must come first: "/static" would otherwise match it
    app.mount(f"/static/{ASSET_VERSION}", StaticFiles(directory=STATIC_DIR), name="static-versioned")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ============================================================================
# [1] FILE VALIDATION CONSTANTS
# ============================================================================
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_IMAGE_SIDE_PX = 1024  # images are downscaled to this before classification


# ============================================================================
# [2] SECURE CREDENTIALS SETUP
# ============================================================================
# Gemini 3.x models on Vertex AI are served only from the "global" endpoint
# (or the "us"/"eu" multi-regions), not from single regions like us-central1.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
# Faster model for latency-sensitive one-shot tasks (wound classification,
# speech-to-text). Flash-Lite defaults to minimal thinking.
GEMINI_FAST_MODEL = os.getenv("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")


def setup_vertex_ai():
    """
    Securely parses GOOGLE_CREDS_JSON env var (a JSON string),
    validates its structure, and returns a Gen AI client bound to Vertex AI.
    Credentials are loaded in memory — nothing is written to disk.
    Returns None (mock mode) if anything is missing or invalid.
    """
    if not GOOGLE_AVAILABLE:
        print("✓ Running in MOCK MODE (Google Cloud AI)")
        return None

    creds_json_str = os.getenv("GOOGLE_CREDS_JSON")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "global")

    if not creds_json_str:
        print("⚠️  GOOGLE_CREDS_JSON not set - using mock mode")
        return None

    # Validate JSON structure
    try:
        creds_data = json.loads(creds_json_str)
        required_fields = ["type", "project_id", "private_key_id", "private_key"]
        missing = [f for f in required_fields if f not in creds_data]
        if missing:
            print(f"⚠️  Credentials JSON missing fields: {missing} - using mock mode")
            return None
    except json.JSONDecodeError as e:
        print(f"⚠️  Invalid JSON in GOOGLE_CREDS_JSON: {e} - using mock mode")
        return None

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", creds_data["project_id"])

    try:
        credentials = service_account.Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        client = genai.Client(
            vertexai=True,
            project=project_id,
            location=location,
            credentials=credentials,
        )
    except Exception as e:
        print(f"⚠️  Failed to initialize Vertex AI client: {e} - using mock mode")
        return None

    print(f"✓ Vertex AI initialized (project={project_id}, location={location}, "
          f"model={GEMINI_MODEL}, fast_model={GEMINI_FAST_MODEL})")
    return client


genai_client = setup_vertex_ai()

# Safety settings shared by all Gemini calls — first-aid content must not be blocked
SAFETY_SETTINGS = [
    types.SafetySetting(category=category, threshold=types.HarmBlockThreshold.BLOCK_NONE)
    for category in (
        types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    )
] if GOOGLE_AVAILABLE else []

# Gemini 3.x models think before answering and thinking tokens count toward
# max_output_tokens — keep thinking low so short answers aren't cut off.
# Used for GEMINI_MODEL only; the fast model keeps its own (minimal) default.
THINKING_CONFIG = (
    types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW) if GOOGLE_AVAILABLE else None
)

# Initialize ElevenLabs
elevenlabs_client = None
if ELEVENLABS_AVAILABLE:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if api_key:
        elevenlabs_client = ElevenLabs(api_key=api_key)
        print("✓ ElevenLabs initialized successfully")
    else:
        print("⚠️  ELEVENLABS_API_KEY not set - using mock mode")


# ============================================================================
# [4] & [5] EXPANDED WOUND TYPES + SEVERITY DETECTION
# ============================================================================

# System instruction for the classification model — now returns TYPE|SEVERITY
CLASSIFICATION_PROMPT = """You are a medical AI triage expert. Analyze the wound image and respond with EXACTLY two words separated by a pipe character:
WOUND_TYPE|SEVERITY

WOUND_TYPE must be one of: Burn, Cut, Bruise, Scrape, Puncture, Sprain, Fracture, Bite
SEVERITY must be one of: Mild, Moderate, Severe

Examples of correct responses:
Burn|Moderate
Cut|Mild
Fracture|Severe

If the image does NOT show an injury on a human or animal body (e.g. an object, landscape, screenshot, text, healthy skin, or a picture too blurry or dark to see any injury), respond with exactly:
NONE

Rules:
- Never guess a wound type for an image that shows no visible injury — respond NONE instead
- If an injury is visible but details are unclear, make your best assessment
- Severe means: deep tissue damage, heavy bleeding, bone visible, large area affected, or requires immediate professional medical attention
- Moderate means: notable injury requiring careful first aid, possible infection risk, may need medical follow-up
- Mild means: superficial, small area, manageable with basic first aid at home
"""

# Comprehensive scenario dictionary: scenario_dict[wound_type][severity]
scenario_dict = {
    "Burn": {
        "Mild": [
            "Run cool (not cold) water over the burn for 10-20 minutes.",
            "Do not apply ice, butter, or toothpaste to the burn.",
            "Apply aloe vera gel or a moisturizing lotion once cooled.",
            "Cover loosely with a sterile non-stick bandage if needed.",
            "Take over-the-counter pain relief like ibuprofen if needed.",
        ],
        "Moderate": [
            "Run cool water over the area of the burn for at least 20 minutes. A clean, cold, wet towel will help reduce pain.",
            "Calm and reassure the person.",
            "After cooling, cover with a dry, sterile bandage or clean dressing.",
            "Protect the burn from pressure and friction.",
            "Over-the-counter ibuprofen or acetaminophen can help relieve pain and swelling.",
            "Do not give aspirin to children under 12.",
            "Do not pop any blisters — they protect against infection.",
            "Seek medical attention if blisters are larger than 3 inches or on the face, hands, or joints.",
        ],
        "Severe": [
            "CALL EMERGENCY SERVICES (112) IMMEDIATELY. This burn requires professional medical care.",
            "Do NOT remove clothing stuck to the burn.",
            "Do NOT immerse large severe burns in water — this can cause shock.",
            "Cover the area loosely with a clean, cool, moist bandage or cloth.",
            "Elevate the burned area above heart level if possible.",
            "Watch for signs of shock: pale skin, weakness, rapid pulse.",
            "Keep the person warm with a blanket over unburned areas.",
            "Do not apply any ointments or creams to severe burns.",
        ],
    },
    "Cut": {
        "Mild": [
            "Wash your hands with soap before treating the wound.",
            "Rinse the cut under clean running water for 1-2 minutes.",
            "Apply gentle pressure with a clean cloth if there is minor bleeding.",
            "Apply a thin layer of antibiotic ointment.",
            "Cover with an adhesive bandage or sterile gauze.",
        ],
        "Moderate": [
            "Wash your hands thoroughly with soap or antibacterial cleanser.",
            "Apply firm, direct pressure with a clean cloth for 10-15 minutes to stop bleeding.",
            "Once bleeding stops, wash the cut thoroughly with mild soap and water.",
            "Remove any visible debris gently with clean tweezers.",
            "Apply antibiotic ointment and cover with a sterile bandage.",
            "Change the bandage daily and watch for signs of infection (redness, swelling, warmth).",
            "Consider a tetanus shot if you haven't had one in 5 years.",
        ],
        "Severe": [
            "CALL EMERGENCY SERVICES (112) IMMEDIATELY for deep cuts with heavy bleeding.",
            "Apply firm, constant pressure with a clean cloth. Do NOT remove it even if blood soaks through — add more layers.",
            "If possible, elevate the injured area above the heart.",
            "If bleeding won't stop after 15 minutes of direct pressure, this is a medical emergency.",
            "Do NOT try to clean a severely bleeding wound.",
            "Keep the person calm and lying down to prevent shock.",
            "If an object is embedded in the wound, do NOT remove it.",
        ],
    },
    "Bruise": {
        "Mild": [
            "Apply a cold compress or ice pack wrapped in a cloth for 10-15 minutes.",
            "Rest the bruised area and avoid further impact.",
            "After 48 hours, you can apply warm compresses to help healing.",
            "Over-the-counter pain relief can help if needed.",
        ],
        "Moderate": [
            "Apply ice wrapped in a cloth for 15-20 minutes, several times a day for the first 48 hours.",
            "Elevate the bruised area above heart level when possible.",
            "Rest the area and avoid activities that could worsen it.",
            "Take ibuprofen for pain and swelling (avoid aspirin as it can increase bleeding).",
            "After 48 hours, switch to warm compresses to promote blood flow and healing.",
            "See a doctor if the bruise doesn't improve after 2 weeks.",
        ],
        "Severe": [
            "Seek medical attention — severe bruising may indicate internal bleeding or fracture.",
            "Apply ice wrapped in cloth for 20 minutes at a time.",
            "Do NOT massage the bruised area.",
            "Watch for signs of compartment syndrome: increasing pain, numbness, or swelling.",
            "If the bruise is on the head or abdomen, seek immediate medical evaluation.",
            "Keep the area elevated and immobilized.",
        ],
    },
    "Scrape": {
        "Mild": [
            "Rinse the scrape gently under clean running water.",
            "Pat dry with a clean cloth.",
            "Apply a thin layer of antibiotic ointment.",
            "Cover with a bandage if the area might get dirty.",
        ],
        "Moderate": [
            "Wash the scraped area thoroughly with mild soap and clean water for 2-3 minutes.",
            "Remove any dirt or debris gently — use clean tweezers if needed.",
            "Apply antibiotic ointment to prevent infection.",
            "Cover with a non-stick sterile bandage.",
            "Change the bandage daily and keep the wound moist for faster healing.",
            "Watch for signs of infection: increasing redness, warmth, swelling, or pus.",
        ],
        "Severe": [
            "For large or deep scrapes (road rash), seek medical attention.",
            "Rinse with clean water but do not scrub aggressively.",
            "Cover with a clean, moist dressing.",
            "Deep scrapes may need professional cleaning to prevent infection.",
            "A tetanus booster may be needed if not current.",
            "Watch for signs of infection over the next few days.",
        ],
    },
    "Puncture": {
        "Mild": [
            "Let the wound bleed slightly to help flush out bacteria.",
            "Wash the area with soap and clean water.",
            "Apply antibiotic ointment and cover with a bandage.",
            "Monitor for signs of infection over the next few days.",
            "Check if your tetanus vaccination is up to date.",
        ],
        "Moderate": [
            "Allow minor bleeding to help clean the wound naturally.",
            "Wash thoroughly with soap and water for several minutes.",
            "Do NOT try to close a puncture wound — it needs to drain.",
            "Apply antibiotic ointment and a loose bandage.",
            "Seek medical attention for a tetanus booster if needed.",
            "Watch closely for infection: redness spreading, fever, red streaks from wound.",
        ],
        "Severe": [
            "CALL EMERGENCY SERVICES (112) for deep puncture wounds.",
            "Do NOT remove any object still embedded in the wound.",
            "Apply pressure around (not on) the object to control bleeding.",
            "Stabilize any embedded object with bulky dressings.",
            "Keep the person still and calm.",
            "Deep punctures to chest, abdomen, or neck are life-threatening emergencies.",
        ],
    },
    "Sprain": {
        "Mild": [
            "Follow R.I.C.E.: Rest, Ice, Compression, Elevation.",
            "Apply ice for 15-20 minutes every 2-3 hours for the first 48 hours.",
            "Use an elastic bandage for gentle compression.",
            "Rest the joint and avoid putting weight on it.",
            "Over-the-counter anti-inflammatory medication can help.",
        ],
        "Moderate": [
            "Apply ice immediately — 20 minutes on, 20 minutes off, for the first 48-72 hours.",
            "Use a compression bandage to reduce swelling (not too tight).",
            "Elevate the injured limb above heart level as much as possible.",
            "Avoid bearing weight — use crutches if it's an ankle or knee.",
            "Take anti-inflammatory medication (ibuprofen) as directed.",
            "See a doctor if you cannot bear weight at all or if swelling is severe.",
            "After 48 hours, gentle range-of-motion exercises can begin.",
        ],
        "Severe": [
            "Seek immediate medical attention — severe sprains may involve torn ligaments.",
            "Immobilize the joint in the position found. Do not try to straighten it.",
            "Apply ice wrapped in cloth to reduce swelling.",
            "Do NOT bear any weight on the injured area.",
            "Elevate above heart level.",
            "A severe sprain can be as serious as a fracture — imaging may be needed.",
        ],
    },
    "Fracture": {
        "Mild": [
            "If you suspect a hairline fracture, immobilize the area.",
            "Apply ice wrapped in cloth for 15-20 minutes.",
            "Do not put weight on the suspected fracture.",
            "See a doctor for X-ray confirmation — even mild fractures need proper treatment.",
            "Use a splint or sling to keep the area still during transport.",
        ],
        "Moderate": [
            "CALL FOR MEDICAL HELP. Fractures require professional treatment.",
            "Do NOT try to realign the bone or push it back in.",
            "Immobilize the area above and below the suspected break.",
            "Apply ice packs wrapped in cloth to reduce swelling.",
            "If there is an open wound near the fracture, cover it with a clean dressing.",
            "Monitor circulation below the injury (check for numbness, cold, or blue color).",
            "Keep the person still and comfortable until help arrives.",
        ],
        "Severe": [
            "CALL EMERGENCY SERVICES (112) IMMEDIATELY.",
            "Do NOT move the person unless they are in immediate danger.",
            "Do NOT try to straighten or realign the limb.",
            "Control any bleeding with gentle pressure around (not on) the fracture site.",
            "Cover any open fracture wounds with a sterile dressing.",
            "Immobilize the area — splint it in the position found using rigid materials.",
            "Watch for shock: pale skin, rapid breathing, confusion.",
            "Keep the person warm and calm until emergency services arrive.",
        ],
    },
    "Bite": {
        "Mild": [
            "Wash the bite area thoroughly with soap and water for 5 minutes.",
            "Apply antibiotic ointment.",
            "Cover with a clean bandage.",
            "Monitor for signs of infection over the next few days.",
            "Note what animal caused the bite for medical records.",
        ],
        "Moderate": [
            "Wash the wound thoroughly with soap and running water for at least 5 minutes.",
            "Apply firm pressure with a clean cloth if bleeding.",
            "Apply antibiotic ointment and cover with a sterile bandage.",
            "Seek medical attention — you may need antibiotics or a tetanus booster.",
            "If it was an animal bite, try to identify the animal (for rabies assessment).",
            "Watch for infection signs: increasing pain, redness, swelling, fever.",
        ],
        "Severe": [
            "CALL EMERGENCY SERVICES (112) for severe bites with heavy bleeding.",
            "Apply firm pressure to control bleeding.",
            "Do NOT try to close the wound — bite wounds are highly prone to infection.",
            "If a body part has been bitten off, wrap it in clean moist cloth and bring it to the hospital.",
            "All animal bites that break the skin should be evaluated for rabies risk.",
            "Human bites that break the skin also require medical attention due to infection risk.",
        ],
    },
}

# Polish scenarios — same keys and the same number of steps as scenario_dict,
# so the voice assistant can switch language mid-procedure. The steps are read
# aloud by TTS, so ranges are written out ("od 10 do 20 minut") and abbreviations
# are avoided.
scenario_dict_pl = {
    "Burn": {
        "Mild": [
            "Schładzaj oparzenie chłodną (nie lodowatą) bieżącą wodą przez 10 do 20 minut.",
            "Nie przykładaj do oparzenia lodu, masła ani pasty do zębów.",
            "Po schłodzeniu nałóż żel z aloesem lub balsam nawilżający.",
            "W razie potrzeby przykryj oparzenie luźno jałowym, nieprzywierającym opatrunkiem.",
            "W razie potrzeby przyjmij lek przeciwbólowy bez recepty, na przykład ibuprofen.",
        ],
        "Moderate": [
            "Schładzaj oparzone miejsce chłodną wodą przez co najmniej 20 minut. Czysty, zimny, wilgotny ręcznik pomoże złagodzić ból.",
            "Uspokój poszkodowanego i dodaj mu otuchy.",
            "Po schłodzeniu przykryj oparzenie suchym, jałowym opatrunkiem lub czystym materiałem.",
            "Chroń oparzone miejsce przed uciskiem i tarciem.",
            "Ibuprofen lub paracetamol bez recepty mogą złagodzić ból i obrzęk.",
            "Nie podawaj aspiryny dzieciom poniżej 12 lat.",
            "Nie przekłuwaj pęcherzy — chronią przed zakażeniem.",
            "Zgłoś się do lekarza, jeśli pęcherze są większe niż 7 centymetrów albo znajdują się na twarzy, dłoniach lub stawach.",
        ],
        "Severe": [
            "NATYCHMIAST ZADZWOŃ POD NUMER ALARMOWY 112. To oparzenie wymaga profesjonalnej pomocy medycznej.",
            "NIE zdejmuj ubrania przyklejonego do oparzenia.",
            "NIE zanurzaj rozległych, ciężkich oparzeń w wodzie — może to wywołać wstrząs.",
            "Przykryj oparzone miejsce luźno czystym, chłodnym, wilgotnym opatrunkiem lub materiałem.",
            "Jeśli to możliwe, unieś oparzoną część ciała powyżej poziomu serca.",
            "Obserwuj objawy wstrząsu: bladą skórę, osłabienie, szybkie tętno.",
            "Chroń poszkodowanego przed wychłodzeniem — okryj kocem nieoparzone części ciała.",
            "Nie nakładaj na ciężkie oparzenia żadnych maści ani kremów.",
        ],
    },
    "Cut": {
        "Mild": [
            "Przed opatrzeniem rany umyj ręce mydłem.",
            "Przepłucz ranę czystą bieżącą wodą przez minutę lub dwie.",
            "Jeśli rana lekko krwawi, delikatnie uciśnij ją czystym materiałem.",
            "Nałóż cienką warstwę maści z antybiotykiem.",
            "Przykryj ranę plastrem z opatrunkiem lub jałową gazą.",
        ],
        "Moderate": [
            "Dokładnie umyj ręce mydłem lub środkiem antybakteryjnym.",
            "Aby zatamować krwawienie, mocno uciskaj ranę czystym materiałem przez 10 do 15 minut.",
            "Gdy krwawienie ustanie, dokładnie umyj ranę łagodnym mydłem i wodą.",
            "Delikatnie usuń widoczne zanieczyszczenia czystą pęsetą.",
            "Nałóż maść z antybiotykiem i przykryj ranę jałowym opatrunkiem.",
            "Zmieniaj opatrunek codziennie i obserwuj objawy zakażenia: zaczerwienienie, obrzęk, ocieplenie skóry.",
            "Rozważ szczepienie przeciw tężcowi, jeśli ostatnie było ponad 5 lat temu.",
        ],
        "Severe": [
            "Przy głębokiej ranie z obfitym krwawieniem NATYCHMIAST ZADZWOŃ POD NUMER ALARMOWY 112.",
            "Uciskaj ranę mocno i bez przerwy czystym materiałem. NIE zdejmuj go, nawet jeśli przesiąknie krwią — dokładaj kolejne warstwy.",
            "Jeśli to możliwe, unieś zranioną część ciała powyżej poziomu serca.",
            "Jeśli krwawienie nie ustaje po 15 minutach ucisku, to stan nagły — potrzebna jest pilna pomoc medyczna.",
            "NIE próbuj oczyszczać silnie krwawiącej rany.",
            "Utrzymuj poszkodowanego w pozycji leżącej i uspokajaj go, aby zapobiec wstrząsowi.",
            "Jeśli w ranie tkwi jakiś przedmiot, NIE wyjmuj go.",
        ],
    },
    "Bruise": {
        "Mild": [
            "Przyłóż zimny okład lub lód owinięty w materiał na 10 do 15 minut.",
            "Oszczędzaj stłuczone miejsce i chroń je przed kolejnymi uderzeniami.",
            "Po 48 godzinach możesz stosować ciepłe okłady, które przyspieszą gojenie.",
            "W razie potrzeby pomoże lek przeciwbólowy bez recepty.",
        ],
        "Moderate": [
            "Przez pierwsze 48 godzin kilka razy dziennie przykładaj lód owinięty w materiał, za każdym razem na 15 do 20 minut.",
            "Gdy to możliwe, unieś stłuczone miejsce powyżej poziomu serca.",
            "Oszczędzaj to miejsce i unikaj czynności, które mogą pogorszyć uraz.",
            "Na ból i obrzęk przyjmij ibuprofen. Unikaj aspiryny, bo może nasilać krwawienie.",
            "Po 48 godzinach przejdź na ciepłe okłady, które poprawią krążenie i przyspieszą gojenie.",
            "Zgłoś się do lekarza, jeśli po 2 tygodniach siniak nie zaczyna znikać.",
        ],
        "Severe": [
            "Zgłoś się do lekarza — rozległe stłuczenie może oznaczać krwawienie wewnętrzne lub złamanie.",
            "Przykładaj lód owinięty w materiał, za każdym razem na 20 minut.",
            "NIE masuj stłuczonego miejsca.",
            "Obserwuj objawy zespołu ciasnoty przedziałów powięziowych: narastający ból, drętwienie lub obrzęk.",
            "Jeśli stłuczenie dotyczy głowy lub brzucha, natychmiast zgłoś się do lekarza.",
            "Utrzymuj to miejsce uniesione i unieruchomione.",
        ],
    },
    "Scrape": {
        "Mild": [
            "Delikatnie przepłucz otarcie czystą bieżącą wodą.",
            "Osusz skórę, delikatnie przykładając czysty materiał.",
            "Nałóż cienką warstwę maści z antybiotykiem.",
            "Jeśli to miejsce może się zabrudzić, przykryj je opatrunkiem.",
        ],
        "Moderate": [
            "Dokładnie myj otarte miejsce łagodnym mydłem i czystą wodą przez 2 do 3 minut.",
            "Delikatnie usuń brud i zanieczyszczenia — w razie potrzeby użyj czystej pęsety.",
            "Nałóż maść z antybiotykiem, aby zapobiec zakażeniu.",
            "Przykryj otarcie jałowym, nieprzywierającym opatrunkiem.",
            "Zmieniaj opatrunek codziennie. Rana goi się szybciej, gdy jest lekko wilgotna.",
            "Obserwuj objawy zakażenia: narastające zaczerwienienie, ocieplenie, obrzęk lub ropę.",
        ],
        "Severe": [
            "Przy rozległych lub głębokich otarciach, na przykład po upadku na asfalt, zgłoś się do lekarza.",
            "Przepłucz otarcie czystą wodą, ale nie szoruj go.",
            "Przykryj otarcie czystym, wilgotnym opatrunkiem.",
            "Głębokie otarcia mogą wymagać profesjonalnego oczyszczenia, aby nie doszło do zakażenia.",
            "Jeśli szczepienie przeciw tężcowi nie jest aktualne, może być potrzebna dawka przypominająca.",
            "Przez kilka następnych dni obserwuj, czy nie pojawiają się objawy zakażenia.",
        ],
    },
    "Puncture": {
        "Mild": [
            "Pozwól ranie lekko pokrwawić — to pomaga wypłukać bakterie.",
            "Umyj to miejsce mydłem i czystą wodą.",
            "Nałóż maść z antybiotykiem i przykryj ranę opatrunkiem.",
            "Przez kilka następnych dni obserwuj, czy nie pojawiają się objawy zakażenia.",
            "Sprawdź, czy masz aktualne szczepienie przeciw tężcowi.",
        ],
        "Moderate": [
            "Pozwól na niewielkie krwawienie — w naturalny sposób oczyszcza ranę.",
            "Dokładnie myj ranę mydłem i wodą przez kilka minut.",
            "NIE próbuj zamykać rany kłutej — wydzielina musi mieć ujście.",
            "Nałóż maść z antybiotykiem i załóż luźny opatrunek.",
            "W razie potrzeby zgłoś się do lekarza po dawkę przypominającą szczepionki przeciw tężcowi.",
            "Uważnie obserwuj objawy zakażenia: szerzące się zaczerwienienie, gorączkę, czerwone smugi biegnące od rany.",
        ],
        "Severe": [
            "Przy głębokiej ranie kłutej ZADZWOŃ POD NUMER ALARMOWY 112.",
            "NIE wyjmuj przedmiotu, który wciąż tkwi w ranie.",
            "Aby opanować krwawienie, uciskaj wokół przedmiotu, a nie na niego.",
            "Unieruchom wbity przedmiot, obkładając go grubymi opatrunkami.",
            "Dopilnuj, aby poszkodowany się nie ruszał, i uspokajaj go.",
            "Głębokie rany kłute klatki piersiowej, brzucha lub szyi bezpośrednio zagrażają życiu.",
        ],
    },
    "Sprain": {
        "Mild": [
            "Zastosuj cztery zasady: odpoczynek, lód, ucisk i uniesienie.",
            "Przez pierwsze 48 godzin przykładaj lód na 15 do 20 minut co 2 do 3 godzin.",
            "Załóż bandaż elastyczny, który będzie delikatnie uciskał.",
            "Oszczędzaj staw i nie obciążaj go.",
            "Pomocny może być lek przeciwzapalny bez recepty.",
        ],
        "Moderate": [
            "Od razu przyłóż lód: 20 minut z lodem, 20 minut przerwy, przez pierwsze 48 do 72 godzin.",
            "Załóż bandaż uciskowy, aby zmniejszyć obrzęk, ale nie za ciasno.",
            "Jak najczęściej trzymaj urażoną kończynę powyżej poziomu serca.",
            "Nie obciążaj kończyny — przy urazie kostki lub kolana używaj kul.",
            "Przyjmuj lek przeciwzapalny, na przykład ibuprofen, zgodnie z ulotką.",
            "Zgłoś się do lekarza, jeśli w ogóle nie możesz obciążyć kończyny albo obrzęk jest duży.",
            "Po 48 godzinach możesz zacząć delikatne ćwiczenia zakresu ruchu.",
        ],
        "Severe": [
            "Natychmiast zgłoś się do lekarza — przy ciężkim skręceniu więzadła mogą być zerwane.",
            "Unieruchom staw w zastanej pozycji. Nie próbuj go prostować.",
            "Przyłóż lód owinięty w materiał, aby zmniejszyć obrzęk.",
            "W ogóle NIE obciążaj urażonego miejsca.",
            "Unieś urażone miejsce powyżej poziomu serca.",
            "Ciężkie skręcenie bywa równie poważne jak złamanie — może być potrzebne prześwietlenie.",
        ],
    },
    "Fracture": {
        "Mild": [
            "Jeśli podejrzewasz pęknięcie kości, unieruchom to miejsce.",
            "Przyłóż lód owinięty w materiał na 15 do 20 minut.",
            "Nie obciążaj miejsca podejrzanego o złamanie.",
            "Zgłoś się do lekarza na prześwietlenie — nawet niewielkie złamanie wymaga leczenia.",
            "Na czas transportu unieruchom to miejsce szyną lub temblakiem.",
        ],
        "Moderate": [
            "WEZWIJ POMOC MEDYCZNĄ. Złamanie wymaga profesjonalnego leczenia.",
            "NIE próbuj nastawiać kości ani wciskać jej z powrotem.",
            "Unieruchom kończynę powyżej i poniżej miejsca podejrzanego złamania.",
            "Przyłóż lód owinięty w materiał, aby zmniejszyć obrzęk.",
            "Jeśli przy złamaniu jest otwarta rana, przykryj ją czystym opatrunkiem.",
            "Kontroluj krążenie poniżej urazu — sprawdzaj, czy nie ma drętwienia, chłodu lub sinego zabarwienia skóry.",
            "Do przyjazdu pomocy dopilnuj, aby poszkodowany się nie ruszał i było mu wygodnie.",
        ],
        "Severe": [
            "NATYCHMIAST ZADZWOŃ POD NUMER ALARMOWY 112.",
            "NIE przenoś poszkodowanego, chyba że grozi mu bezpośrednie niebezpieczeństwo.",
            "NIE próbuj prostować ani nastawiać kończyny.",
            "Tamuj krwawienie, delikatnie uciskając wokół miejsca złamania, a nie na nie.",
            "Rany przy złamaniu otwartym przykryj jałowym opatrunkiem.",
            "Unieruchom to miejsce w zastanej pozycji, używając sztywnych materiałów jako szyny.",
            "Obserwuj objawy wstrząsu: bladą skórę, przyspieszony oddech, splątanie.",
            "Do przyjazdu służb ratunkowych chroń poszkodowanego przed wychłodzeniem i uspokajaj go.",
        ],
    },
    "Bite": {
        "Mild": [
            "Dokładnie myj miejsce ugryzienia mydłem i wodą przez 5 minut.",
            "Nałóż maść z antybiotykiem.",
            "Przykryj ranę czystym opatrunkiem.",
            "Przez kilka następnych dni obserwuj, czy nie pojawiają się objawy zakażenia.",
            "Zapamiętaj, jakie zwierzę cię ugryzło — ta informacja przyda się lekarzowi.",
        ],
        "Moderate": [
            "Dokładnie myj ranę mydłem pod bieżącą wodą przez co najmniej 5 minut.",
            "Jeśli rana krwawi, mocno uciśnij ją czystym materiałem.",
            "Nałóż maść z antybiotykiem i przykryj ranę jałowym opatrunkiem.",
            "Zgłoś się do lekarza — może być potrzebny antybiotyk lub dawka przypominająca szczepionki przeciw tężcowi.",
            "Jeśli ugryzło cię zwierzę, spróbuj ustalić, jakie — to ważne przy ocenie ryzyka wścieklizny.",
            "Obserwuj objawy zakażenia: narastający ból, zaczerwienienie, obrzęk, gorączkę.",
        ],
        "Severe": [
            "Przy ciężkim ugryzieniu z obfitym krwawieniem ZADZWOŃ POD NUMER ALARMOWY 112.",
            "Mocno uciskaj ranę, aby opanować krwawienie.",
            "NIE próbuj zamykać rany — rany po ugryzieniu bardzo łatwo ulegają zakażeniu.",
            "Jeśli doszło do odgryzienia części ciała, owiń ją w czysty, wilgotny materiał i zabierz do szpitala.",
            "Każde ugryzienie przez zwierzę, które przerwało skórę, wymaga oceny ryzyka wścieklizny.",
            "Ugryzienie przez człowieka, które przerwało skórę, także wymaga pomocy lekarza ze względu na ryzyko zakażenia.",
        ],
    },
}

# ============================================================================
# LANGUAGES — the app runs in Polish by default; English stays available
# ============================================================================
SCENARIOS = {"en": scenario_dict, "pl": scenario_dict_pl}
DEFAULT_API_LANG = "en"  # API default kept for backward compatibility; the app always sends lang


def normalize_lang(lang: str) -> str:
    """Return a supported language code, falling back to the API default."""
    lang = (lang or "").strip().lower()
    return lang if lang in SCENARIOS else DEFAULT_API_LANG


# User-facing messages returned by the API
MESSAGES = {
    "en": {
        "invalid_type": "Invalid file type: {ctype}. Allowed: {allowed}",
        "invalid_ext": "Invalid file extension: {ext}. Allowed: {allowed}",
        "too_large": "File too large: {size}MB. Maximum: {max}MB",
        "empty_file": "Empty file uploaded",
        "not_image": "File is not a valid image",
        "no_injury": "No injury detected in this photo. Please take a clear, close-up photo of the wound.",
        "analysis_failed": "Analysis failed: {error}",
        "chat_mock": "This is a demo response. To get real AI responses, please configure your Google Cloud API keys.",
    },
    "pl": {
        "invalid_type": "Nieobsługiwany typ pliku: {ctype}. Dozwolone: {allowed}",
        "invalid_ext": "Nieobsługiwane rozszerzenie pliku: {ext}. Dozwolone: {allowed}",
        "too_large": "Plik jest za duży: {size} MB. Maksymalnie: {max} MB",
        "empty_file": "Przesłano pusty plik",
        "not_image": "Plik nie jest prawidłowym obrazem",
        "no_injury": "Nie wykryto urazu na tym zdjęciu. Zrób wyraźne zdjęcie rany z bliska.",
        "analysis_failed": "Analiza nie powiodła się: {error}",
        "chat_mock": "To jest odpowiedź demonstracyjna. Aby otrzymywać prawdziwe odpowiedzi AI, skonfiguruj klucze Google Cloud.",
    },
}


def tr(lang: str, key: str, **kwargs) -> str:
    """Translate an API message into the given language."""
    return MESSAGES[normalize_lang(lang)][key].format(**kwargs)


# Flat lookup for backward compatibility: returns first matching severity scenario
def get_scenario_for_diagnosis(wound_type: str, severity: str, lang: str = DEFAULT_API_LANG) -> List[str]:
    """Get scenario steps for a given wound type, severity and language."""
    type_scenarios = SCENARIOS[normalize_lang(lang)].get(wound_type, {})
    if isinstance(type_scenarios, dict):
        return type_scenarios.get(severity, type_scenarios.get("Moderate", []))
    # Backward compat: if it's a flat list
    return type_scenarios if isinstance(type_scenarios, list) else []


def get_all_scenarios(wound_type: str, severity: str) -> Dict[str, List[str]]:
    """Scenario steps in every supported language (lets the UI switch language without re-analyzing)."""
    return {lang: get_scenario_for_diagnosis(wound_type, severity, lang) for lang in SCENARIOS}


# Chat system instruction
system_instruction_model_more_info = (
    "You are an AI emergency medical expert. Analyze the conversation history "
    "and clarify the user's query regarding the current first-aid step. "
    "Provide a calm, actionable response limited to a maximum of 3 short sentences."
)

# Appended to the chat instruction so answers match the app language
CHAT_LANGUAGE_RULE = {
    "en": " Always respond in English.",
    "pl": " Always respond in Polish.",
}

# Transcription system instruction — Gemini multimodal STT for iOS voice control
transcription_instruction = (
    "You are a speech-to-text engine. Transcribe the spoken audio. "
    "Return ONLY the spoken words in lowercase English, no punctuation, no quotes, no explanation. "
    "If the audio is silent or unclear, return an empty string."
)

TRANSCRIPTION_INSTRUCTIONS = {
    "en": transcription_instruction,
    "pl": (
        "You are a speech-to-text engine. Transcribe the spoken audio. The speaker speaks Polish. "
        "Return ONLY the spoken words in lowercase Polish (keep Polish diacritics), "
        "no punctuation, no quotes, no explanation. "
        "If the audio is silent or unclear, return an empty string."
    ),
}


# ============================================================================
# ROUTES
# ============================================================================

class AudioRequest(BaseModel):
    prompt: str

class ChatRequest(BaseModel):
    history: List[Dict]
    lang: str = DEFAULT_API_LANG


def serve_page(filename: str) -> str:
    """Read an HTML page and point its asset URLs at the versioned path (see ASSET_VERSION)."""
    try:
        with open(filename, "r", encoding="utf-8") as f:
            html = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"{filename} not found")
    return html.replace('"/static/', f'"/static/{ASSET_VERSION}/')


@app.get("/", response_class=HTMLResponse)
def home():
    return serve_page("index.html")


@app.get("/phone", response_class=HTMLResponse)
def phone():
    """Desktop preview: the app inside an iPhone frame (index.html redirects here)."""
    return serve_page("phone.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # Browsers request /favicon.ico on their own; the pages also link the SVG icon
    return FileResponse(os.path.join(STATIC_DIR, "icons", "favicon.ico"), media_type="image/x-icon")


# ---------------------------------------------------------------------------
# [1] FILE VALIDATION + [4][5] SEVERITY DETECTION + EXPANDED WOUND TYPES
# ---------------------------------------------------------------------------
@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze(request: Request, file: UploadFile = File(...), lang: str = Form(DEFAULT_API_LANG)):
    lang = normalize_lang(lang)

    # --- File validation ---
    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=tr(lang, "invalid_type", ctype=file.content_type, allowed=", ".join(ALLOWED_MIME_TYPES)),
        )

    # Check extension
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=tr(lang, "invalid_ext", ext=ext, allowed=", ".join(ALLOWED_EXTENSIONS)),
        )

    # Read and check size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_BYTES:
        size_mb = f"{len(contents) / 1024 / 1024:.1f}"
        if lang == "pl":
            size_mb = size_mb.replace(".", ",")  # Polish decimal comma
        raise HTTPException(
            status_code=400,
            detail=tr(lang, "too_large", size=size_mb, max=MAX_FILE_SIZE_MB),
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail=tr(lang, "empty_file"))

    # Validate it's actually an image
    try:
        img = PIL.Image.open(io.BytesIO(contents))
        img.verify()  # Verify it's a valid image
        img = PIL.Image.open(io.BytesIO(contents))  # Re-open after verify
    except Exception:
        raise HTTPException(status_code=400, detail=tr(lang, "not_image"))

    # --- Mock response for demo ---
    if genai_client is None:
        wound_type = "Burn"
        severity = "Moderate"
        return {
            "diagnosis": wound_type,
            "severity": severity,
            "scenario_array": get_scenario_for_diagnosis(wound_type, severity, lang),
            "scenarios": get_all_scenarios(wound_type, severity),
            "mock": True,
        }

    # --- AI Classification ---
    # Downscale phone photos — smaller uploads mean faster responses, and
    # 1024px is plenty to classify a wound. JPEG needs RGB (PNGs may be RGBA).
    img = img.convert("RGB")
    img.thumbnail((MAX_IMAGE_SIDE_PX, MAX_IMAGE_SIDE_PX))
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG', quality=85)
    image_part = types.Part.from_bytes(data=img_byte_arr.getvalue(), mime_type="image/jpeg")

    try:
        response = await genai_client.aio.models.generate_content(
            model=GEMINI_FAST_MODEL,
            contents=[image_part, "Classify this wound. Respond with TYPE|SEVERITY, or NONE if no injury is visible."],
            config=types.GenerateContentConfig(
                system_instruction=CLASSIFICATION_PROMPT,
                temperature=0.0,
                max_output_tokens=1024,
                safety_settings=SAFETY_SETTINGS,
            ),
        )

        raw_response = (response.text or "").strip()
        print(f"[AI] Raw classification: {raw_response}")

        # Parse TYPE|SEVERITY response
        wound_type, severity = parse_classification(raw_response)

        if wound_type is None:
            return {"error": tr(lang, "no_injury")}

        return {
            "diagnosis": wound_type,
            "severity": severity,
            "scenario_array": get_scenario_for_diagnosis(wound_type, severity, lang),
            "scenarios": get_all_scenarios(wound_type, severity),
        }
    except Exception as e:
        print(f"[ERROR] Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=tr(lang, "analysis_failed", error=str(e)))


def parse_classification(raw: str) -> tuple:
    """
    Parse AI response like 'Burn|Moderate' into (wound_type, severity).
    Returns (None, None) when no injury was detected or the response
    names no known wound type.
    """
    valid_types = set(scenario_dict.keys())
    valid_severities = {"Mild", "Moderate", "Severe"}

    if raw.strip().upper().startswith("NONE"):
        return None, None

    # Try pipe-separated format
    if "|" in raw:
        parts = [p.strip().capitalize() for p in raw.split("|")]
        if len(parts) >= 2:
            wtype = parts[0]
            sev = parts[1]
            if wtype in valid_types and sev in valid_severities:
                return wtype, sev

    # Fallback: try to find known words in the response
    raw_lower = raw.lower()
    found_type = None  # no known type → treat as no injury
    found_severity = "Moderate"  # default

    for t in valid_types:
        if t.lower() in raw_lower:
            found_type = t
            break

    for s in valid_severities:
        if s.lower() in raw_lower:
            found_severity = s
            break

    if found_type is None:
        return None, None

    return found_type, found_severity


# ---------------------------------------------------------------------------
# [3] RATE LIMITED CHAT ENDPOINT
# ---------------------------------------------------------------------------
@app.post("/more")
@limiter.limit("20/minute")
async def more(request: Request, chat_request: ChatRequest):
    lang = normalize_lang(chat_request.lang)

    # Mock response for demo
    if genai_client is None:
        return {"text": tr(lang, "chat_mock"), "mock": True}

    try:
        full_history = chat_request.history
        if not full_history:
            raise HTTPException(status_code=400, detail="Empty history")

        user_message = full_history[-1]["parts"][0]
        previous_history_raw = full_history[:-1]

        formatted_history = []
        for msg in previous_history_raw:
            role = msg.get("role", "user")
            text_part = msg.get("parts", [""])[0]
            formatted_history.append(
                types.Content(role=role, parts=[types.Part.from_text(text=text_part)])
            )

        chat = genai_client.aio.chats.create(
            model=GEMINI_MODEL,
            history=formatted_history,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction_model_more_info + CHAT_LANGUAGE_RULE[lang],
                temperature=0.3,
                max_output_tokens=2048,
                safety_settings=SAFETY_SETTINGS,
                thinking_config=THINKING_CONFIG,
            ),
        )
        response = await chat.send_message(user_message)

        return {"text": (response.text or "").strip()}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR /more]: {str(e)}")
        raise HTTPException(status_code=500, detail="AI processing failed")


# ---------------------------------------------------------------------------
# AUDIO TRANSCRIPTION — used by iOS-friendly voice control flow.
# Browser records short utterances and sends them here for STT via Gemini.
# ---------------------------------------------------------------------------
ALLOWED_AUDIO_MIMES = {
    "audio/webm", "audio/webm;codecs=opus",
    "audio/ogg", "audio/ogg;codecs=opus",
    "audio/mp4", "audio/m4a", "audio/x-m4a",
    "audio/mpeg", "audio/wav", "audio/x-wav",
}
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # 5MB — covers ~30s of typical recording


@app.post("/transcribe")
@limiter.limit("60/minute")
async def transcribe(request: Request, file: UploadFile = File(...), lang: str = Form(DEFAULT_API_LANG)):
    lang = normalize_lang(lang)

    # Validate MIME (lenient — browsers report variations)
    ctype = (file.content_type or "").lower().split(";")[0].strip()
    base_allowed = {m.split(";")[0] for m in ALLOWED_AUDIO_MIMES}
    if ctype and ctype not in base_allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {ctype}")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(contents) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio too large")

    # Mock response for dev mode
    if genai_client is None:
        return {"transcript": "", "mock": True}

    # Use the actual MIME the browser sent (Gemini accepts most common formats)
    mime = file.content_type or "audio/webm"
    if ";" in mime:
        mime = mime.split(";")[0]

    try:
        audio_part = types.Part.from_bytes(data=contents, mime_type=mime)
        response = await genai_client.aio.models.generate_content(
            model=GEMINI_FAST_MODEL,
            contents=[audio_part, "Transcribe the spoken words. Return only the words, lowercase, no punctuation."],
            config=types.GenerateContentConfig(
                system_instruction=TRANSCRIPTION_INSTRUCTIONS[lang],
                temperature=0.0,
                max_output_tokens=1024,
                safety_settings=SAFETY_SETTINGS,
            ),
        )
        text = (response.text or "").strip().lower()
        # Strip surrounding quotes if Gemini adds them (incl. Polish „…” and typographic quotes)
        text = text.strip('"\'`„”“‚‘’«»')
        return {"transcript": text}
    except Exception as e:
        print(f"[ERROR /transcribe]: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed")


# ---------------------------------------------------------------------------
# [6] FIXED MOCK AUDIO — returns a real silent WAV file instead of JSON
# ---------------------------------------------------------------------------
import struct as _struct

def _generate_silent_wav(duration_ms: int = 600) -> bytes:
    """Generate a valid WAV file with silence. WAV is universally supported by browsers."""
    sample_rate = 22050
    num_channels = 1
    bits_per_sample = 16
    num_samples = int(sample_rate * duration_ms / 1000)
    data_size = num_samples * num_channels * (bits_per_sample // 8)

    # WAV header (44 bytes) + silent PCM data
    header = _struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF',
        36 + data_size,       # file size - 8
        b'WAVE',
        b'fmt ',
        16,                   # chunk size
        1,                    # PCM format
        num_channels,
        sample_rate,
        sample_rate * num_channels * bits_per_sample // 8,  # byte rate
        num_channels * bits_per_sample // 8,                # block align
        bits_per_sample,
        b'data',
        data_size,
    )
    return header + (b'\x00' * data_size)

# Pre-generate silent audio at startup
SILENT_AUDIO = _generate_silent_wav(600)
SILENT_AUDIO_MIME = "audio/wav"


def get_safe_filename(text: str) -> str:
    pl_chars = "pąćęłńóśźż"
    en_chars = "aceelnoszz"
    text = text.lower()
    for p, e in zip(pl_chars, en_chars):
        text = text.replace(p, e)
    text = re.sub(r'[^a-z0-9\s]', '', text)
    filename = text.replace(" ", "_")[:50]
    return f"{filename}.mp3"


# ElevenLabs voice per language. Both defaults are ElevenLabs "Default" voices,
# which ElevenLabs retires on 2026-12-31 — set ELEVENLABS_VOICE_EN / _PL to voices
# from your own voice library (e.g. a native Polish voice) before then.
LEGACY_EN_VOICE = "JBFqnCBsd6RMkjVDRZzb"  # George — the voice of the recordings in recordings/
ELEVENLABS_VOICES = {
    "en": os.getenv("ELEVENLABS_VOICE_EN", LEGACY_EN_VOICE),
    "pl": os.getenv("ELEVENLABS_VOICE_PL", "EXAVITQu4vr4xnSDxMaL"),  # Sarah
}
POLISH_TO_ASCII = str.maketrans("ąćęłńóśźż", "acelnoszz")


def get_audio_filename(text: str, lang: str, voice_id: str) -> str:
    """
    Cache file name for a TTS recording. English with the original voice keeps
    the legacy naming so the recordings already in recordings/ are reused; any
    other language/voice gets a readable prefix plus a hash of voice and text,
    so changing a voice re-generates its audio instead of serving the old one.
    """
    if lang == "en" and voice_id == LEGACY_EN_VOICE:
        return get_safe_filename(text)
    stem = re.sub(r"[^a-z0-9]+", "_", text.lower().translate(POLISH_TO_ASCII)).strip("_")[:40]
    digest = hashlib.sha1(f"{voice_id}|{text}".encode("utf-8")).hexdigest()[:10]
    return f"{lang}_{stem}_{digest}.mp3"


RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)


@app.get("/get_audio")
@limiter.limit("30/minute")
async def get_audio(request: Request, prompt: str, lang: str = DEFAULT_API_LANG):
    prompt_text = prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="Empty prompt")

    lang = normalize_lang(lang)
    voice_id = ELEVENLABS_VOICES[lang]
    filename = get_audio_filename(prompt_text, lang, voice_id)
    file_path = os.path.join(RECORDINGS_DIR, filename)

    # Serve from cache
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        return FileResponse(file_path, media_type="audio/mpeg")

    # [6] Mock mode: return a real silent MP3 (not JSON!)
    if not ELEVENLABS_AVAILABLE or elevenlabs_client is None:
        return Response(
            content=SILENT_AUDIO,
            media_type=SILENT_AUDIO_MIME,
            headers={"X-Mock-Audio": "true"}
        )

    # Real TTS generation
    try:
        # ElevenLabs SDK v1.x uses .convert() instead of .stream()
        audio_data_iterator = elevenlabs_client.text_to_speech.convert(
            text=prompt_text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )

        temp_file_path = file_path + ".tmp"
        with open(temp_file_path, "wb") as f:
            for chunk in audio_data_iterator:
                if chunk:
                    f.write(chunk)

        # Verify the file is non-empty before serving
        if os.path.getsize(temp_file_path) == 0:
            os.remove(temp_file_path)
            raise RuntimeError("ElevenLabs returned empty audio")

        os.rename(temp_file_path, file_path)
        return FileResponse(file_path, media_type="audio/mpeg")

    except Exception as e:
        print(f"[ERROR TTS]: {e}")
        # Fallback to silent audio on error — don't break the voice assistant
        return Response(content=SILENT_AUDIO, media_type=SILENT_AUDIO_MIME)


# ============================================================================
# ENTRY POINT
# ============================================================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
