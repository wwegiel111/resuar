# Bugfix Requirements Document

## Introduction

The new frontend (index.html) replaced the old frontend (index-old.html) but is missing two critical pieces of functionality: (1) the voice-guided first aid assistant that walks users through scenario steps using TTS audio and speech recognition, and (2) proper mobile layout where the fixed bottom navigation bar does not overlap scrollable page content.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user clicks "Start Voice Assistant" on the diagnosis screen THEN the system only toggles UI elements (shows transcription card, changes button text) without initiating any speech recognition or audio playback

1.2 WHEN the `/analyze` endpoint returns a `scenario_array` in its response THEN the system ignores the scenario array entirely and does not use it for step-by-step voice guidance

1.3 WHEN the voice assistant is "active" THEN the system does not use the Web Speech API (SpeechRecognition) to listen for voice commands ("next", "repeat", "more", "stop")

1.4 WHEN the voice assistant is "active" THEN the system does not call the `/get_audio` endpoint to generate and play TTS audio for scenario steps

1.5 WHEN the user says "more" during voice guidance THEN the system does not enter a Q&A mode or call the `/more` endpoint to ask follow-up questions

1.6 WHEN the user says "next" during voice guidance THEN the system does not advance to the next scenario step

1.7 WHEN viewing any screen on mobile THEN the fixed bottom navigation bar (`.main-nav`, ~70-80px tall) overlaps the bottom portion of scrollable content because the screen wrapper uses `height: 100%; overflow: hidden` within a `100vh` container, making the `padding-bottom: 90px` on `.screen` elements insufficient to prevent content from being hidden behind the nav

### Expected Behavior (Correct)

2.1 WHEN the user clicks "Start Voice Assistant" on the diagnosis screen THEN the system SHALL begin playing the first scenario step via TTS audio from `/get_audio` and start listening for voice commands after audio finishes

2.2 WHEN the `/analyze` endpoint returns a `scenario_array` THEN the system SHALL store the array and use it as the sequence of steps for voice-guided first aid instructions

2.3 WHEN audio for a scenario step finishes playing THEN the system SHALL activate Web Speech API (SpeechRecognition) to listen for voice commands ("next", "repeat", "more", "stop")

2.4 WHEN the user says "next" THEN the system SHALL advance to the next scenario step and play its audio via `/get_audio`

2.5 WHEN the user says "repeat" THEN the system SHALL replay the current scenario step audio via `/get_audio`

2.6 WHEN the user says "more" THEN the system SHALL enter Q&A mode, announce it via audio, and listen for a free-form question to send to the `/more` endpoint with conversation history

2.7 WHEN the user says "stop" THEN the system SHALL stop the voice assistant, cease audio playback and speech recognition

2.8 WHEN the user asks a question in Q&A mode THEN the system SHALL send the question with conversation history to `/more`, display the response as a chat bubble, and play the response via `/get_audio`

2.9 WHEN viewing any screen on mobile THEN the system SHALL ensure all page content is fully scrollable and never hidden behind the fixed bottom navigation bar

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user takes or selects a photo and clicks "Analyze result" THEN the system SHALL CONTINUE TO send the image to `/analyze` and display the diagnosis on the diagnosis screen

3.2 WHEN the user navigates between screens using the bottom nav or back buttons THEN the system SHALL CONTINUE TO switch screens correctly with proper active states

3.3 WHEN the user uses the CPR timer feature THEN the system SHALL CONTINUE TO provide the metronome, breathing sounds, and countdown functionality

3.4 WHEN the user interacts with the AI Chat screen THEN the system SHALL CONTINUE TO display messages in the chat interface

3.5 WHEN the user views the app on desktop (≥768px) THEN the system SHALL CONTINUE TO display the sidebar navigation layout without any layout changes

3.6 WHEN the user clicks "Stop Voice Assistant" or "End Process" THEN the system SHALL CONTINUE TO properly reset the UI state and stop any active audio/recognition
