// V3: real i18n demonstration slice — not the whole app. Covers the
// highest-traffic surfaces (landing page, primary nav, expedition
// mode-selection, and sign-in) in 2 additional languages beyond English:
// Spanish (the most widely spoken second language among likely users) and
// Hindi (proves the infrastructure handles a non-Latin script, not just a
// find-and-replace of Latin-alphabet strings). Every other surface falls
// back to English via the `t()` lookup below — that fallback is the
// documented, deliberate scope boundary for this pass, not a bug.
export type SupportedLanguage = 'en' | 'es' | 'hi';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
];

export type TranslationKey = keyof typeof en;

const en = {
  appTagline: 'The Living Field Guide',
  talkToGuide: 'Talk to the Guide',
  startLiveExpedition: 'Start a Live Expedition',
  browseCommunityFeed: 'Or Browse The Community Feed',

  navFeed: 'Feed',
  navJournal: 'My Journal',
  navMap: 'Species Map',
  navNewExpedition: 'New Expedition',
  navFieldAlerts: 'Field Alerts',
  navProfile: 'Profile',
  navHome: 'NatureGram home',
  navStartExpedition: 'Start new expedition',
  navMyProfile: 'My Profile',

  modeSelectTitle: 'Select Expedition Mode',
  modeSelectSubtitle: 'How should the agent behave?',
  modeObservationTitle: 'Observation',
  modeObservationDesc: 'The agent acts as a silent observer, providing insights only when significant events occur or when asked.',
  modeConversationTitle: 'Conversation',
  modeConversationDesc: 'The agent is an active companion, engaging in real-time dialogue about your surroundings and findings.',
  modeUploadTitle: 'Upload',
  modeUploadAnalyzing: 'Analyzing...',
  modeUploadDesc: 'Analyze a photo, video, or sound file from your device — no camera or microphone needed.',
  modeCancel: 'Cancel',

  authJoinTitle: 'Join the Field',
  authWelcomeBackTitle: 'Welcome Back',
  authSubtitle: 'Sign in to publish your discoveries.',
  authEmailPlaceholder: 'Explorer Email',
  authPasswordPlaceholder: 'Password',
  auth6Chars: '6+ Chars',
  authNumber: 'Number',
  authSymbol: 'Symbol',
  authCreateAccount: 'Create Account',
  authSignIn: 'Sign In',
  authProcessing: 'Processing...',
  authToggleToSignIn: 'Already have an account? Sign In',
  authToggleToSignUp: 'Need an account? Sign Up',
  authCloseLabel: 'Close sign-in dialog',

  languageSwitcherLabel: 'Language',
};

const es: typeof en = {
  appTagline: 'La Guía de Campo Viviente',
  talkToGuide: 'Habla con el Guía',
  startLiveExpedition: 'Iniciar una Expedición en Vivo',
  browseCommunityFeed: 'O Explora el Feed de la Comunidad',

  navFeed: 'Inicio',
  navJournal: 'Mi Diario',
  navMap: 'Mapa de Especies',
  navNewExpedition: 'Nueva Expedición',
  navFieldAlerts: 'Alertas de Campo',
  navProfile: 'Perfil',
  navHome: 'Inicio de NatureGram',
  navStartExpedition: 'Iniciar nueva expedición',
  navMyProfile: 'Mi Perfil',

  modeSelectTitle: 'Selecciona el Modo de Expedición',
  modeSelectSubtitle: '¿Cómo debe comportarse el agente?',
  modeObservationTitle: 'Observación',
  modeObservationDesc: 'El agente actúa como un observador silencioso, dando información solo cuando ocurren eventos importantes o cuando se le pregunta.',
  modeConversationTitle: 'Conversación',
  modeConversationDesc: 'El agente es un compañero activo, dialogando en tiempo real sobre tu entorno y hallazgos.',
  modeUploadTitle: 'Subir',
  modeUploadAnalyzing: 'Analizando...',
  modeUploadDesc: 'Analiza una foto, video o archivo de audio desde tu dispositivo — no se necesita cámara ni micrófono.',
  modeCancel: 'Cancelar',

  authJoinTitle: 'Únete al Campo',
  authWelcomeBackTitle: 'Bienvenido de Nuevo',
  authSubtitle: 'Inicia sesión para publicar tus descubrimientos.',
  authEmailPlaceholder: 'Correo del Explorador',
  authPasswordPlaceholder: 'Contraseña',
  auth6Chars: '6+ Caracteres',
  authNumber: 'Número',
  authSymbol: 'Símbolo',
  authCreateAccount: 'Crear Cuenta',
  authSignIn: 'Iniciar Sesión',
  authProcessing: 'Procesando...',
  authToggleToSignIn: '¿Ya tienes una cuenta? Inicia sesión',
  authToggleToSignUp: '¿Necesitas una cuenta? Regístrate',
  authCloseLabel: 'Cerrar diálogo de inicio de sesión',

  languageSwitcherLabel: 'Idioma',
};

const hi: typeof en = {
  appTagline: 'जीवंत फील्ड गाइड',
  talkToGuide: 'गाइड से बात करें',
  startLiveExpedition: 'लाइव अभियान शुरू करें',
  browseCommunityFeed: 'या समुदाय फ़ीड ब्राउज़ करें',

  navFeed: 'फ़ीड',
  navJournal: 'मेरी डायरी',
  navMap: 'प्रजाति मानचित्र',
  navNewExpedition: 'नया अभियान',
  navFieldAlerts: 'फील्ड अलर्ट',
  navProfile: 'प्रोफ़ाइल',
  navHome: 'नेचरग्राम होम',
  navStartExpedition: 'नया अभियान शुरू करें',
  navMyProfile: 'मेरी प्रोफ़ाइल',

  modeSelectTitle: 'अभियान मोड चुनें',
  modeSelectSubtitle: 'एजेंट को कैसा व्यवहार करना चाहिए?',
  modeObservationTitle: 'अवलोकन',
  modeObservationDesc: 'एजेंट एक मूक पर्यवेक्षक के रूप में कार्य करता है, केवल महत्वपूर्ण घटनाओं के समय या पूछे जाने पर जानकारी देता है।',
  modeConversationTitle: 'बातचीत',
  modeConversationDesc: 'एजेंट एक सक्रिय साथी है, जो आपके परिवेश और खोजों के बारे में वास्तविक समय में संवाद करता है।',
  modeUploadTitle: 'अपलोड करें',
  modeUploadAnalyzing: 'विश्लेषण हो रहा है...',
  modeUploadDesc: 'अपने डिवाइस से फ़ोटो, वीडियो या ध्वनि फ़ाइल का विश्लेषण करें — कैमरा या माइक्रोफ़ोन की आवश्यकता नहीं।',
  modeCancel: 'रद्द करें',

  authJoinTitle: 'फील्ड से जुड़ें',
  authWelcomeBackTitle: 'वापसी पर स्वागत है',
  authSubtitle: 'अपनी खोजें प्रकाशित करने के लिए साइन इन करें।',
  authEmailPlaceholder: 'एक्सप्लोरर ईमेल',
  authPasswordPlaceholder: 'पासवर्ड',
  auth6Chars: '6+ अक्षर',
  authNumber: 'अंक',
  authSymbol: 'प्रतीक',
  authCreateAccount: 'खाता बनाएं',
  authSignIn: 'साइन इन करें',
  authProcessing: 'प्रोसेस हो रहा है...',
  authToggleToSignIn: 'पहले से ही खाता है? साइन इन करें',
  authToggleToSignUp: 'खाता चाहिए? साइन अप करें',
  authCloseLabel: 'साइन-इन संवाद बंद करें',

  languageSwitcherLabel: 'भाषा',
};

export const TRANSLATIONS: Record<SupportedLanguage, typeof en> = { en, es, hi };
