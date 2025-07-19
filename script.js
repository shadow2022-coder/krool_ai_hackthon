// App State
let isListening = false;
let isProcessing = false;
let currentSession = [];
let sessionHistory = JSON.parse(localStorage.getItem('therapy_ai_history') || '[]');
const n8nWebhookUrl = "YOUR_N8N_WEBHOOK_URL_HERE"; // Replace with your actual webhook URL

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const processingOrb = document.getElementById('processing-orb');
const orbStatus = document.getElementById('orb-status');
const chatMessages = document.getElementById('chat-messages');
const historyBtn = document.getElementById('history-btn');
const historySidebar = document.getElementById('history-sidebar');
const historyList = document.getElementById('history-list');
const closeHistoryBtn = document.getElementById('close-history');
const clearHistoryBtn = document.getElementById('clear-history');

// Vosk Setup
let voskRecognizer = null;
let audioContext = null;
let mediaStream = null;

// Initialize Vosk
async function initializeVosk() {
  try {
    orbStatus.textContent = "Loading...";
    const model = await Vosk.createModel('models/vosk-model-small-en-us.zip');
    voskRecognizer = new Vosk.Recognizer({ model, sampleRate: 16000 });
    orbStatus.textContent = "Tap to start";
    return true;
  } catch (error) {
    orbStatus.textContent = "Error loading model";
    console.error('Vosk initialization error:', error);
    return false;
  }
}

// Start Speech Recognition
async function startListening() {
  if (isListening || isProcessing) return;
  
  if (!voskRecognizer) {
    const initialized = await initializeVosk();
    if (!initialized) return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio: { 
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      } 
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!isListening) return;
      
      const inputData = event.inputBuffer.getChannelData(0);
      const recognized = voskRecognizer.acceptWaveform(inputData);
      
      if (recognized) {
        const result = voskRecognizer.result();
        if (result.text && result.text.trim()) {
          handleSpeechResult(result.text.trim());
        }
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    // Update UI
    isListening = true;
    processingOrb.classList.add('listening');
    orbStatus.textContent = "Listening...";
    micBtn.style.background = '#ff3b30';
    pauseBtn.disabled = false;

  } catch (error) {
    orbStatus.textContent = "Microphone access denied";
    console.error('Media access error:', error);
  }
}

// Stop Listening
function stopListening() {
  if (!isListening) return;

  isListening = false;
  processingOrb.classList.remove('listening');
  micBtn.style.background = '#007aff';
  pauseBtn.disabled = true;

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  orbStatus.textContent = "Tap to start";
}

// Handle Speech Recognition Result
function handleSpeechResult(text) {
  stopListening();
  addMessage('user', text);
  currentSession.push({ sender: 'user', text: text, timestamp: new Date().toISOString() });
  sendToBackend(text);
}

// Add Message to Chat
function addMessage(sender, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}-message`;
  messageDiv.textContent = text;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send to n8n Webhook
async function sendToBackend(userInput) {
  isProcessing = true;
  orbStatus.textContent = "Processing...";
  processingOrb.classList.add('listening');

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userInput: userInput,
        sessionId: Date.now().toString(),
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const aiResponse = data.response || data.message || "I'm here to help. Could you tell me more?";
    
    addMessage('ai', aiResponse);
    currentSession.push({ sender: 'ai', text: aiResponse, timestamp: new Date().toISOString() });
    
    // Text-to-Speech
    speakText(aiResponse);

  } catch (error) {
    console.error('Backend error:', error);
    const errorMessage = "I'm having trouble connecting right now. Please try again.";
    addMessage('ai', errorMessage);
    currentSession.push({ sender: 'ai', text: errorMessage, timestamp: new Date().toISOString() });
    speakText(errorMessage);
  }

  isProcessing = false;
  processingOrb.classList.remove('listening');
  orbStatus.textContent = "Tap to continue";
}

// Text-to-Speech
function speakText(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 0.8;
    
    utterance.onstart = () => {
      processingOrb.classList.add('listening');
      orbStatus.textContent = "Speaking...";
    };
    
    utterance.onend = () => {
      processingOrb.classList.remove('listening');
      orbStatus.textContent = "Tap to continue";
    };
    
    speechSynthesis.speak(utterance);
  }
}

// End Session
function endSession() {
  stopListening();
  
  if (currentSession.length > 0) {
    sessionHistory.push({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      messages: [...currentSession]
    });
    localStorage.setItem('therapy_ai_history', JSON.stringify(sessionHistory));
    updateHistoryUI();
  }
  
  currentSession = [];
  chatMessages.innerHTML = '';
  orbStatus.textContent = "Session ended. Tap to start new session.";
}

// History Management
function updateHistoryUI() {
  historyList.innerHTML = '';
  
  sessionHistory.slice().reverse().forEach((session, index) => {
    const li = document.createElement('li');
    const date = new Date(session.timestamp).toLocaleDateString();
    const messageCount = session.messages.length;
    li.textContent = `Session ${sessionHistory.length - index} (${date}) - ${messageCount} messages`;
    
    li.onclick = () => {
      loadSession(session);
      hideHistory();
    };
    
    historyList.appendChild(li);
  });
}

function loadSession(session) {
  chatMessages.innerHTML = '';
  session.messages.forEach(msg => {
    addMessage(msg.sender, msg.text);
  });
}

function showHistory() {
  updateHistoryUI();
  historySidebar.classList.add('visible');
}

function hideHistory() {
  historySidebar.classList.remove('visible');
}

function clearAllHistory() {
  if (confirm('Are you sure you want to clear all conversation history?')) {
    sessionHistory = [];
    localStorage.removeItem('therapy_ai_history');
    updateHistoryUI();
    hideHistory();
  }
}

// Event Listeners
micBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

pauseBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  }
});

stopBtn.addEventListener('click', endSession);
historyBtn.addEventListener('click', showHistory);
closeHistoryBtn.addEventListener('click', hideHistory);
clearHistoryBtn.addEventListener('click', clearAllHistory);

// Orb click handler
processingOrb.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

// Initialize
updateHistoryUI();
orbStatus.textContent = "Tap to start";

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
});
