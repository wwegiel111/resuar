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
from fastapi import FastAPI, UploadFile, File, Request, HTTPException
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

# Mount static assets
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.isdir(STATIC_DIR):
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

# Flat lookup for backward compatibility: returns first matching severity scenario
def get_scenario_for_diagnosis(wound_type: str, severity: str) -> List[str]:
    """Get scenario steps for a given wound type and severity."""
    type_scenarios = scenario_dict.get(wound_type, {})
    if isinstance(type_scenarios, dict):
        return type_scenarios.get(severity, type_scenarios.get("Moderate", []))
    # Backward compat: if it's a flat list
    return type_scenarios if isinstance(type_scenarios, list) else []


# Chat system instruction
system_instruction_model_more_info = (
    "You are an AI emergency medical expert. Analyze the conversation history "
    "and clarify the user's query regarding the current first-aid step. "
    "Provide a calm, actionable response limited to a maximum of 3 short sentences."
)

# Transcription system instruction — Gemini multimodal STT for iOS voice control
transcription_instruction = (
    "You are a speech-to-text engine. Transcribe the spoken audio. "
    "Return ONLY the spoken words in lowercase English, no punctuation, no quotes, no explanation. "
    "If the audio is silent or unclear, return an empty string."
)


# ============================================================================
# ROUTES
# ============================================================================

class AudioRequest(BaseModel):
    prompt: str

class ChatRequest(BaseModel):
    history: List[Dict]


@app.get("/", response_class=HTMLResponse)
def home():
    try:
        with open("index.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="index.html not found")


@app.get("/phone", response_class=HTMLResponse)
def phone():
    """Desktop preview: the app inside an iPhone frame (index.html redirects here)."""
    try:
        with open("phone.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="phone.html not found")


# ---------------------------------------------------------------------------
# [1] FILE VALIDATION + [4][5] SEVERITY DETECTION + EXPANDED WOUND TYPES
# ---------------------------------------------------------------------------
@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze(request: Request, file: UploadFile = File(...)):
    # --- File validation ---
    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Allowed: {', '.join(ALLOWED_MIME_TYPES)}"
        )

    # Check extension
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read and check size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {len(contents) / 1024 / 1024:.1f}MB. Maximum: {MAX_FILE_SIZE_MB}MB"
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # Validate it's actually an image
    try:
        img = PIL.Image.open(io.BytesIO(contents))
        img.verify()  # Verify it's a valid image
        img = PIL.Image.open(io.BytesIO(contents))  # Re-open after verify
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a valid image")

    # --- Mock response for demo ---
    if genai_client is None:
        wound_type = "Burn"
        severity = "Moderate"
        return {
            "diagnosis": wound_type,
            "severity": severity,
            "scenario_array": get_scenario_for_diagnosis(wound_type, severity),
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
            return {
                "error": "No injury detected in this photo. Please take a clear, close-up photo of the wound.",
            }

        scenario = get_scenario_for_diagnosis(wound_type, severity)

        return {
            "diagnosis": wound_type,
            "severity": severity,
            "scenario_array": scenario,
        }
    except Exception as e:
        print(f"[ERROR] Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


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
    # Mock response for demo
    if genai_client is None:
        return {
            "text": "This is a demo response. To get real AI responses, please configure your Google Cloud API keys.",
            "mock": True,
        }

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
                system_instruction=system_instruction_model_more_info,
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
async def transcribe(request: Request, file: UploadFile = File(...)):
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
                system_instruction=transcription_instruction,
                temperature=0.0,
                max_output_tokens=1024,
                safety_settings=SAFETY_SETTINGS,
            ),
        )
        text = (response.text or "").strip().lower()
        # Strip surrounding quotes if Gemini adds them
        text = text.strip('"\'`')
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


RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)


@app.get("/get_audio")
@limiter.limit("30/minute")
async def get_audio(request: Request, prompt: str):
    prompt_text = prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="Empty prompt")

    filename = get_safe_filename(prompt_text)
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
            voice_id="JBFqnCBsd6RMkjVDRZzb",
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
