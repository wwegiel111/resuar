# Rescuar - AI-Powered First Aid Assistant

An intelligent emergency first aid guidance system that uses AI image recognition and voice interaction to provide real-time medical assistance for common injuries.

## Overview

Rescuar is a web-based application that helps users respond to medical emergencies by:
- **Analyzing injury images** using Google's Gemini AI to classify wounds (burns, cuts, etc.)
- **Providing step-by-step guidance** tailored to the specific injury type
- **Offering voice-based interaction** with text-to-speech for hands-free operation
- **Supporting multilingual assistance** with audio responses in multiple languages

## Features

### 🔍 Intelligent Image Analysis
- Upload photos of injuries for AI-powered classification
- Automatic detection of burn severity and wound types
- Powered by Google Vertex AI (Gemini 2.5 Flash)

### 🎙️ Voice-Guided Instructions
- Text-to-speech audio guidance for each first aid step
- Cached audio responses for faster retrieval
- Multilingual support via ElevenLabs API
- Hands-free operation for emergency situations

### 💬 Conversational Support
- Ask follow-up questions about current first aid steps
- AI-powered clarification and additional guidance
- Context-aware responses based on conversation history

### 📋 Pre-configured Scenarios
- **Burns**: 7-step cooling and care protocol
- **Cuts**: 4-step cleaning and bandaging protocol
- Extensible scenario system for additional injury types

## Tech Stack

- **Backend**: FastAPI (Python)
- **AI/ML**: Google Vertex AI (Gemini 2.5 Flash)
- **Text-to-Speech**: ElevenLabs API
- **Image Processing**: Pillow
- **Frontend**: HTML/JavaScript (served via FastAPI)

## Prerequisites

- Python 3.8+
- Google Cloud Project with Vertex AI enabled
- ElevenLabs API key
- Environment variables configured (see Setup)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd resuar
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables**
   ```bash
   export GOOGLE_CREDS_JSON='<your-google-credentials-json>'
   export GOOGLE_CLOUD_PROJECT='your-project-id'
   export ELEVENLABS_API_KEY='your-elevenlabs-api-key'
   export PORT=8000  # Optional, defaults to 8000
   ```

## Running the Application

```bash
python main.py
```

The application will start on `http://localhost:8000`

## API Endpoints

### `GET /`
Serves the main HTML interface.

### `POST /analyze`
Analyzes an uploaded injury image and returns diagnosis and guidance steps.

**Request:**
- `file`: Image file (JPEG, PNG, etc.)

**Response:**
```json
{
  "diagnosis": "Poparzenie",
  "scenario_array": [
    "Run cool water over the area of the burn...",
    "Calm and reassure the person...",
    ...
  ]
}
```

### `POST /more`
Provides clarification or additional guidance based on conversation history.

**Request:**
```json
{
  "history": [
    {"role": "user", "parts": ["What should I do?"]},
    {"role": "model", "parts": ["First aid step..."]}
  ]
}
```

**Response:**
```json
{
  "text": "Additional guidance or clarification..."
}
```

### `GET /get_audio`
Generates or retrieves cached audio for a given prompt using text-to-speech.

**Query Parameters:**
- `prompt`: Text to convert to speech

**Response:** MP3 audio file

## Project Structure

```
resuar/
├── main.py                 # FastAPI application and core logic
├── index.html             # Frontend interface
├── requirements.txt       # Python dependencies
├── scenarios.txt          # First aid scenario documentation
├── recordings/            # Cached audio files
└── README.md             # This file
```

## How It Works

1. **User uploads an injury image** via the web interface
2. **Gemini AI analyzes the image** and classifies the injury type
3. **System retrieves the appropriate first aid scenario** (burns, cuts, etc.)
4. **Audio guidance is generated** for each step using ElevenLabs
5. **User can ask follow-up questions** which are answered using conversation context
6. **All audio is cached** to reduce API calls and improve response time

## Safety & Limitations

⚠️ **Important**: Rescuar is designed as a **supplementary guidance tool** and should not replace professional medical advice. In life-threatening emergencies, always call emergency services (911 in the US, 112 in EU, etc.).

- AI classifications are based on image analysis and may not be 100% accurate
- Always verify guidance with medical professionals when possible
- For severe injuries, seek immediate professional medical attention

## Configuration

### Supported Injury Types

Currently configured scenarios:
- **Poparzenie** (Polish for "Burn"): Multi-step cooling and care protocol
- **Rozcięcie** (Polish for "Cut"): Cleaning and bandaging protocol

Additional scenarios can be added by extending the `scenario_dict` in `main.py`.

### AI Models

- **Image Classification**: `gemini-2.5-flash` with medical expert system instruction
- **Conversation**: `gemini-2.5-flash` with emergency medical expert system instruction
- **Text-to-Speech**: ElevenLabs multilingual model (`eleven_multilingual_v2`)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_CREDS_JSON` | Google Cloud service account credentials (JSON) | Yes |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID | No (defaults to "rescuar") |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for text-to-speech | Yes |
| `PORT` | Server port | No (defaults to 8000) |

## Error Handling

The application includes error handling for:
- Missing credentials or API keys
- Failed image analysis
- Audio generation failures
- Invalid file uploads

Errors are returned as JSON responses with descriptive messages.

## Performance Optimization

- **Audio Caching**: Generated audio files are cached in the `recordings/` directory to avoid redundant API calls
- **Filename Sanitization**: Polish characters are converted to ASCII equivalents for cross-platform compatibility
- **Streaming Audio**: Audio is streamed from ElevenLabs to reduce memory usage

## Future Enhancements

- [ ] Support for additional injury types (fractures, poisoning, etc.)
- [ ] Multi-language UI support
- [ ] Real-time video analysis
- [ ] Integration with emergency services
- [ ] Offline mode with pre-cached guidance
- [ ] Mobile app version

## Contributing

Contributions are welcome! Please ensure:
- Code follows PEP 8 style guidelines
- New features include appropriate error handling
- API changes are documented

## License

[Add your license information here]

## Support

For issues, questions, or suggestions, please open an issue on the repository.

---

**Disclaimer**: This application is provided for educational and informational purposes. Always seek professional medical advice in emergency situations.
