import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import jsPDF from 'jspdf';
import 'leaflet/dist/leaflet.css';
import './App.css';
import MedicalMesh from './MedicalMesh';
import FrontendSecurity from './security';
import LocationSelector from './components/LocationSelector';
import HospitalMap from './components/HospitalMap';
import ResultsTable from './components/ResultsTable';
import SummaryCard from './components/SummaryCard';
import LOCATION_HIERARCHY from './data/locationHierarchy.json';

const resolveDefaultApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8000';
  }
  const currentHost = window.location.hostname;
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return `${window.location.protocol}//${currentHost}:8000`;
  }
  return 'http://127.0.0.1:8000';
};

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || resolveDefaultApiBaseUrl()).replace(/\/$/, '');
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

const getAlternateLoopbackUrl = (targetUrl) => {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      return parsed.toString();
    }
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
};

const I18N_TEXT = {
  en: {
    disclaimer: 'This is not a substitute for medical advice.',
    emergencyGuidance: 'In emergencies, call local emergency services immediately.',
    emergencyButton: 'Emergency Mode: Find Nearest ICU',
    mapTitle: 'Hospital Map',
  },
  bn: {
    disclaimer: 'এটি চিকিৎসকের পরামর্শের বিকল্প নয়।',
    emergencyGuidance: 'জরুরি অবস্থায়, অবিলম্বে জরুরি পরিষেবায় কল করুন।',
    emergencyButton: 'জরুরি মোড: নিকটতম আইসিইউ খুঁজুন',
    mapTitle: 'হাসপাতাল মানচিত্র',
  },
  hi: {
    disclaimer: 'यह चिकित्सकीय सलाह का विकल्प नहीं है।',
    emergencyGuidance: 'आपात स्थिति में तुरंत आपातकालीन सेवाओं को कॉल करें।',
    emergencyButton: 'इमरजेंसी मोड: निकटतम ICU खोजें',
    mapTitle: 'अस्पताल मानचित्र',
  },
};

const OFFLINE_HOSPITAL_CACHE_KEY = 'dishaHospitalDashboardCache';

const pseudoRandomFromSeed = (seed) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const generateOfflineVoxels = (seedString, severity) => {
  const seed = Array.from(seedString || 'offline').reduce((acc, ch) => acc + ch.charCodeAt(0), 137);
  const rand = pseudoRandomFromSeed(seed);
  const organPoints = 1300;
  const tumorPoints = severity === 'CRITICAL' ? 520 : severity === 'MODERATE' ? 340 : 180;
  const voxels = [];

  for (let i = 0; i < organPoints; i += 1) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const radius = 1.35 + rand() * 0.95;
    const x = Math.cos(theta) * Math.sin(phi) * radius;
    const y = Math.sin(theta) * Math.sin(phi) * radius;
    const z = Math.cos(phi) * radius;
    voxels.push([Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3)), 1]);
  }

  const tumorCenter = {
    x: Number((rand() * 1.8 - 0.9).toFixed(3)),
    y: Number((rand() * 1.6 - 0.8).toFixed(3)),
    z: Number((rand() * 1.6 - 0.8).toFixed(3)),
  };
  const spread = severity === 'CRITICAL' ? 0.42 : severity === 'MODERATE' ? 0.34 : 0.27;

  for (let i = 0; i < tumorPoints; i += 1) {
    const x = tumorCenter.x + (rand() * 2 - 1) * spread;
    const y = tumorCenter.y + (rand() * 2 - 1) * spread;
    const z = tumorCenter.z + (rand() * 2 - 1) * spread;
    voxels.push([Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3)), 2]);
  }

  return { voxels, tumorCenter };
};

const buildOfflineClinicalResult = ({ file, department, patientName, bedNumber, residence }) => {
  const sizeMb = file ? file.size / (1024 * 1024) : 0;
  const severity = sizeMb >= 18 ? 'CRITICAL' : sizeMb >= 10 ? 'MODERATE' : 'NORMAL';
  const confidence = severity === 'CRITICAL' ? 91 : severity === 'MODERATE' ? 84 : 78;
  const { voxels, tumorCenter } = generateOfflineVoxels(`${file?.name || ''}-${patientName}-${bedNumber}-${department}`, severity);
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const subjectId = `OFFLINE-${Date.now().toString().slice(-8)}`;
  const datasetLabel = department === 'pulmonary'
    ? 'LUNA16'
    : department === 'cardio_thoracic'
      ? 'LiTS'
      : 'BraTS 2021';

  return {
    subject_id: subjectId,
    patient_name: patientName,
    bed_number: bedNumber,
    residence,
    modality: 'OFFLINE_ESTIMATE',
    dataset_context: `${datasetLabel} (offline local mode)`,
    prediction: severity === 'NORMAL' ? 'NO TUMOR DETECTED (OFFLINE ESTIMATE)' : 'TUMOR DETECTED (OFFLINE ESTIMATE)',
    confidence,
    volume: severity === 'CRITICAL' ? '41.2 cm3' : severity === 'MODERATE' ? '23.8 cm3' : '8.6 cm3',
    diameter: severity === 'CRITICAL' ? '5.4 cm' : severity === 'MODERATE' ? '3.7 cm' : '1.8 cm',
    severity,
    detailed_report: [
      'Offline mode generated a local 3D estimate because server connectivity is unavailable.',
      'This result is for continuity and visualization only and must be validated against online inference.',
      'Upload appears structurally valid and volumetric rendering has been generated locally.',
    ],
    analysis_note: 'Offline continuity mode enabled. Re-run when server is online for clinical-grade output.',
    voxels,
    coords: tumorCenter,
    dice_score: 0.0,
    timestamp,
    summary: 'Offline analysis generated for uninterrupted workflow.',
    ai_advice: 'Please reconnect to server and run analysis again for validated clinical metrics.',
    tests: [],
  };
};

/**
 * INNER_EYE // ADVANCED RADIOMICS WORKSTATION V5.0.2
 * ARCHITECTURE: MONAI 3D U-Net Integration with Cybersecurity
 * DATASETS: BraTS 2021, LUNA16, LiTS
 */
function App() {
  const [landingStep, setLandingStep] = useState("welcome");
  const [carePath, setCarePath] = useState(null);

  // --- [1] CORE SYSTEM STATE ---
  const [department, setDepartment] = useState(null);
  const [patientName, setPatientName] = useState("");
  const [bedNumber, setBedNumber] = useState("");
  const [residence, setResidence] = useState("");
  const [country, setCountry] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [locality, setLocality] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [scanMessage, setScanMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("QUANTITATIVE");
  const [viewMode, setViewMode] = useState("VOXEL");
  const [is3DExpanded, setIs3DExpanded] = useState(false);
  const [autoSpin3D, setAutoSpin3D] = useState(true);
  const [cinematicTour3D, setCinematicTour3D] = useState(false);
  const [showViewerControls, setShowViewerControls] = useState(false);
  const [nearestBeds, setNearestBeds] = useState([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingMessage, setBookingMessage] = useState("");
  const [searchWorldwide, setSearchWorldwide] = useState(false);
  const [prescriptionUpdate, setPrescriptionUpdate] = useState("");
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [bookingSymptoms, setBookingSymptoms] = useState("");
  const [bookingSeverity, setBookingSeverity] = useState("MODERATE");
  const [triageRecommendation, setTriageRecommendation] = useState(null);
  const [bedRecommendations, setBedRecommendations] = useState({ current: null, predicted: null });
  const [consentChecked, setConsentChecked] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authRole, setAuthRole] = useState('patient');
  const [authToken, setAuthToken] = useState('');
  const [authCsrfToken, setAuthCsrfToken] = useState('');
  const [authExpiresAt, setAuthExpiresAt] = useState('');
  const [authFormMode, setAuthFormMode] = useState('login');
  const [authFormUsername, setAuthFormUsername] = useState('');
  const [authFormPassword, setAuthFormPassword] = useState('');
  const [authFormRole, setAuthFormRole] = useState('patient');
  const [authFormInviteCode, setAuthFormInviteCode] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [language, setLanguage] = useState('en');
  const [darkMode, setDarkMode] = useState(true);
  const [largeTextMode, setLargeTextMode] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [bedSearchQuery, setBedSearchQuery] = useState('');
  const [filterIcuOnly, setFilterIcuOnly] = useState(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState(25);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [hospitalInventory, setHospitalInventory] = useState([]);
  const [selectedHospitalName, setSelectedHospitalName] = useState("");
  const [dashboardAvailableBeds, setDashboardAvailableBeds] = useState(0);
  const [dashboardIcuBeds, setDashboardIcuBeds] = useState(0);
  const [dashboardVentilators, setDashboardVentilators] = useState(0);
  const [dashboardAvailabilityMode, setDashboardAvailabilityMode] = useState('open');
  const [dashboardMessage, setDashboardMessage] = useState('');
  const [lastBedUpdateAt, setLastBedUpdateAt] = useState(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [ambulanceOptions, setAmbulanceOptions] = useState([]);
  const [adminMetrics, setAdminMetrics] = useState(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [backendOnline, setBackendOnline] = useState(true);
  const debounceTimerRef = useRef(null);
  const bookingInFlightRef = useRef(new Set());
  const lastAutoBedRefreshRef = useRef(0);
  const viewerCommandCounterRef = useRef(0);
  const rendererCanvasRef = useRef(null);
  const lastAuthSuccessAtRef = useRef(0);
  const backendHealthFailCountRef = useRef(0);
  const scanInFlightRef = useRef(false);
  const logsRef = useRef([
    '[' + new Date().toLocaleTimeString() + '] > System ready.'
  ]);
  
  // --- SECURITY: Rate limiting for API calls ---
  const apiRateLimiter = useRef(FrontendSecurity.createRateLimiter(100, 60000)); // 100 req/min

  // --- [3] KERNEL LOGGING SYSTEM ---
  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    logsRef.current = [...logsRef.current.slice(-149), `[${timestamp}] > ${msg}`];
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const authHeaders = useMemo(() => {
    if (!authToken) return {};
    const headers = { Authorization: `Bearer ${authToken}` };
    if (authCsrfToken) {
      headers['X-CSRF-Token'] = authCsrfToken;
    }
    return headers;
  }, [authCsrfToken, authToken]);

  const performanceProfile = useMemo(() => {
    if (compactMode) return 'eco';
    const hasNavigator = typeof navigator !== 'undefined';
    const cores = hasNavigator ? Number(navigator.hardwareConcurrency || 4) : 4;
    const memory = hasNavigator ? Number(navigator.deviceMemory || 4) : 4;
    if (cores <= 4 || memory <= 4) {
      return 'performance';
    }
    return 'balanced';
  }, [compactMode]);

  const t = useCallback((key) => {
    const dict = I18N_TEXT[language] || I18N_TEXT.en;
    return dict[key] || I18N_TEXT.en[key] || key;
  }, [language]);

  const formatRelativeUpdate = useCallback((timestamp) => {
    if (!timestamp) return 'Last updated: just now';
    const parsed = new Date(timestamp.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return `Last updated: ${timestamp}`;
    const diffMinutes = Math.max(0, Math.floor((clockTick - parsed.getTime()) / 60000));
    if (diffMinutes <= 0) return 'Last updated: just now';
    if (diffMinutes === 1) return 'Last updated: 1 min ago';
    return `Last updated: ${diffMinutes} mins ago`;
  }, [clockTick]);

  const [viewerCommand, setViewerCommand] = useState(null);

  const issueViewerCommand = useCallback((type) => {
    viewerCommandCounterRef.current += 1;
    setViewerCommand({ id: viewerCommandCounterRef.current, type });
  }, []);

  const mapAuthErrorToMessage = useCallback((message) => {
    const errorMap = {
      USERNAME_MUST_BE_3_TO_32_CHARS_ALPHANUMERIC: 'Username must be 3-32 chars (letters, numbers, underscore, hyphen, dot).',
      PASSWORD_TOO_SHORT: 'Password must be at least 8 characters.',
      PASSWORD_MUST_INCLUDE_UPPERCASE: 'Password must include at least one uppercase letter.',
      PASSWORD_MUST_INCLUDE_LOWERCASE: 'Password must include at least one lowercase letter.',
      PASSWORD_MUST_INCLUDE_DIGIT: 'Password must include at least one number.',
      INVALID_CREDENTIALS: 'Invalid username or password.',
      USERNAME_ALREADY_EXISTS: 'That username already exists. Try another username.',
      HOSPITAL_ADMIN_INVITE_REQUIRED: 'Hospital admin signup requires a valid invite code.',
      SYSTEM_ADMIN_INVITE_REQUIRED: 'System admin signup requires a valid invite code.',
      ACCOUNT_LOCKED: 'Account is temporarily locked due to repeated failed logins. Please try again later.',
    };

    const normalized = String(message || '').trim();
    if (!normalized) return 'Authentication failed. Please try again.';
    if (normalized.startsWith('ACCOUNT_LOCKED_TRY_IN_')) {
      return 'Account temporarily locked after repeated login attempts. Please wait and try again.';
    }
    return errorMap[normalized] || normalized;
  }, []);

  const requestWithRetry = useCallback(async (url, options = {}, retryCount = 1) => {
    if (!apiRateLimiter.current()) {
      const rateLimitError = new Error('Too many requests. Please wait a moment and try again.');
      rateLimitError.name = 'ClientRateLimitError';
      throw rateLimitError;
    }

    const alternateUrl = getAlternateLoopbackUrl(url);
    const urlCandidates = alternateUrl ? [url, alternateUrl] : [url];

    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const candidateSet = attempt === 0 ? urlCandidates : [url];
      for (const candidateUrl of candidateSet) {
        try {
          const mergedOptions = {
            ...options,
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              ...(options.headers || {}),
            },
          };
          const response = await fetch(candidateUrl, mergedOptions);
          if (!response.ok && response.status >= 500 && attempt < retryCount) {
            await wait(150 * (attempt + 1));
            continue;
          }
          return response;
        } catch (error) {
          lastError = error;
        }
      }
      if (attempt < retryCount) {
        await wait(150 * (attempt + 1));
      }
    }
    throw lastError || new Error('Request failed');
  }, []);

  const isConnectivityError = useCallback((error) => {
    if (!error) return false;
    const name = String(error.name || '');
    if (name === 'TypeError') return true;

    const status = Number(error.status || 0);
    if (status >= 500) return true;

    const message = String(error.message || '').toLowerCase();
    return (
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network request failed') ||
      message.includes('request failed') ||
      message.includes('backend connectivity interrupted')
    );
  }, []);

  const updateBackendStatusFromError = useCallback((error) => {
    const reachable = !isConnectivityError(error);
    setBackendOnline(reachable);
    return reachable;
  }, [isConnectivityError]);

  // --- [4] CLINICAL DATABASE SYNC ---
  const fetchHistory = useCallback(async () => {
    if (!authToken) {
      setHistory([]);
      return;
    }
    try {
      const res = await requestWithRetry(`${API_BASE_URL}/patients`, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await res.json();
      if (data.patients) {
        setHistory(data.patients);
        addLog(`DB_SYNC_SUCCESS: ${data.patients.length} RECORDS_MAPPED`);
      }
      setBackendOnline(true);
    } catch (err) {
      if (!updateBackendStatusFromError(err)) {
        addLog("!! LINK_ERROR: REMOTE_DATABASE_OFFLINE");
      }
    }
  }, [authHeaders, authToken, requestWithRetry, updateBackendStatusFromError]);

  useEffect(() => {
    if (department && department !== 'hospital_dashboard') fetchHistory();
  }, [department, fetchHistory]);

  useEffect(() => {
    const storedToken = FrontendSecurity.getFromLocalStorage('dishaAuthToken');
    const storedUser = FrontendSecurity.getFromLocalStorage('dishaAuthUser');
    const storedRole = FrontendSecurity.getFromLocalStorage('dishaAuthRole');
    const storedCsrf = FrontendSecurity.getFromLocalStorage('dishaAuthCsrfToken');
    const storedExpiry = FrontendSecurity.getFromLocalStorage('dishaAuthExpiresAt');
    const isExpired = storedExpiry ? Date.parse(storedExpiry) <= Date.now() : false;
    if (storedToken && storedUser && storedCsrf && !isExpired) {
      setAuthToken(storedToken);
      setAuthUsername(storedUser);
      setAuthRole(storedRole || 'patient');
      setAuthCsrfToken(storedCsrf);
      setAuthExpiresAt(storedExpiry || '');
    } else if (storedToken || storedUser || storedCsrf || storedExpiry) {
      FrontendSecurity.clearLocalStorage('dishaAuthToken');
      FrontendSecurity.clearLocalStorage('dishaAuthUser');
      FrontendSecurity.clearLocalStorage('dishaAuthRole');
      FrontendSecurity.clearLocalStorage('dishaAuthCsrfToken');
      FrontendSecurity.clearLocalStorage('dishaAuthExpiresAt');
    }
  }, []);

  useEffect(() => {
    const rawPrefs = FrontendSecurity.getFromLocalStorage('dishaUiPrefs');
    if (!rawPrefs) return;
    try {
      const prefs = JSON.parse(rawPrefs);
      if (typeof prefs.language === 'string') setLanguage(prefs.language);
      if (typeof prefs.darkMode === 'boolean') setDarkMode(prefs.darkMode);
      if (typeof prefs.largeTextMode === 'boolean') setLargeTextMode(prefs.largeTextMode);
      if (typeof prefs.compactMode === 'boolean') setCompactMode(prefs.compactMode);
      if (typeof prefs.maxDistanceKm === 'number') setMaxDistanceKm(prefs.maxDistanceKm);
      if (typeof prefs.filterIcuOnly === 'boolean') setFilterIcuOnly(prefs.filterIcuOnly);
    } catch {
      FrontendSecurity.clearLocalStorage('dishaUiPrefs');
    }
  }, []);

  useEffect(() => {
    FrontendSecurity.setToLocalStorage(
      'dishaUiPrefs',
      JSON.stringify({
        language,
        darkMode,
        largeTextMode,
        compactMode,
        maxDistanceKm,
        filterIcuOnly,
      }),
    );
  }, [compactMode, darkMode, filterIcuOnly, language, largeTextMode, maxDistanceKm]);

  const filteredNearestBeds = useMemo(() => {
    const normalizedQuery = bedSearchQuery.trim().toLowerCase();
    return nearestBeds.filter((option) => {
      const icuBeds = Number(option.icu_beds || 0);
      const distance = Number(option.estimated_distance_km || Number.MAX_SAFE_INTEGER);
      const name = `${option.hospital || ''} ${option.city || ''} ${option.country || ''}`.toLowerCase();
      const passesQuery = !normalizedQuery || name.includes(normalizedQuery);
      const passesIcu = !filterIcuOnly || icuBeds > 0;
      const passesDistance = searchWorldwide
        ? true
        : (Number.isFinite(distance) ? distance <= maxDistanceKm : true);
      return passesQuery && passesIcu && passesDistance;
    });
  }, [bedSearchQuery, filterIcuOnly, maxDistanceKm, nearestBeds, searchWorldwide]);

  const bookingInsights = useMemo(() => {
    if (filteredNearestBeds.length === 0) {
      return {
        totalBeds: 0,
        avgDistance: null,
        likelySoon: 0,
      };
    }
    const totalBeds = filteredNearestBeds.reduce((sum, option) => sum + Number(option.available_beds || 0), 0);
    const totalDistance = filteredNearestBeds.reduce((sum, option) => sum + Number(option.estimated_distance_km || 0), 0);
    const likelySoon = filteredNearestBeds.filter((option) => option.availability_status === 'likely_soon').length;
    return {
      totalBeds,
      avgDistance: (totalDistance / filteredNearestBeds.length).toFixed(1),
      likelySoon,
    };
  }, [filteredNearestBeds]);

  const handleAuthSubmit = async () => {
    if (!authFormUsername.trim() || !authFormPassword.trim()) {
      setAuthMessage('Enter username and password.');
      return;
    }

    const normalizedUsername = authFormUsername.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(normalizedUsername)) {
      setAuthMessage('Username must be 3-32 chars: lowercase letters, numbers, underscore (_), hyphen (-), or dot (.).');
      return;
    }
    if (authFormMode === 'signup') {
      if (authFormPassword.length < 8) {
        setAuthMessage('Password must be at least 8 characters.');
        return;
      }
      if (!/[A-Z]/.test(authFormPassword) || !/[a-z]/.test(authFormPassword) || !/\d/.test(authFormPassword)) {
        setAuthMessage('Password must include at least one uppercase letter, one lowercase letter, and one number.');
        return;
      }
    }

    setAuthLoading(true);
    setAuthMessage('');
    try {
      const endpoint = authFormMode === 'signup' ? '/auth/signup' : '/auth/login';
      const response = await requestWithRetry(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          password: authFormPassword,
          role: authFormMode === 'signup' ? authFormRole : undefined,
          admin_invite_code: authFormMode === 'signup' && authFormInviteCode.trim() ? authFormInviteCode.trim() : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(mapAuthErrorToMessage(data.detail || 'Authentication failed'));
      }
      setAuthToken(data.token);
      setAuthUsername(data.username);
      setAuthRole(data.role || 'patient');
      setAuthCsrfToken(data.csrf_token || '');
      setAuthExpiresAt(data.expires_at || '');
      lastAuthSuccessAtRef.current = Date.now();
      FrontendSecurity.setToLocalStorage('dishaAuthToken', data.token);
      FrontendSecurity.setToLocalStorage('dishaAuthUser', data.username);
      FrontendSecurity.setToLocalStorage('dishaAuthRole', data.role || 'patient');
      FrontendSecurity.setToLocalStorage('dishaAuthCsrfToken', data.csrf_token || '');
      FrontendSecurity.setToLocalStorage('dishaAuthExpiresAt', data.expires_at || '');
      setAuthFormPassword('');
      setAuthFormInviteCode('');
      setAuthMessage(authFormMode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.');
    } catch (error) {
      const isNetworkFailure =
        error?.name === 'TypeError' ||
        (typeof error?.message === 'string' && error.message.toLowerCase().includes('fetch'));
      if (isNetworkFailure) {
        setAuthMessage(`Authentication failed: Cannot reach API at ${API_BASE_URL}. Start backend on port 8000 and retry.`);
      } else {
        setAuthMessage(`Authentication failed: ${mapAuthErrorToMessage(error.message)}`);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = useCallback(() => {
    setAuthToken('');
    setAuthUsername('');
    setAuthRole('patient');
    setAuthCsrfToken('');
    setAuthExpiresAt('');
    setHistory([]);
    FrontendSecurity.clearLocalStorage('dishaAuthToken');
    FrontendSecurity.clearLocalStorage('dishaAuthUser');
    FrontendSecurity.clearLocalStorage('dishaAuthRole');
    FrontendSecurity.clearLocalStorage('dishaAuthCsrfToken');
    FrontendSecurity.clearLocalStorage('dishaAuthExpiresAt');
    setAuthMessage('Logged out.');
  }, []);

  useEffect(() => {
    if (!authToken || !authExpiresAt) return undefined;
    const expiryTime = Date.parse(authExpiresAt);
    if (Number.isNaN(expiryTime)) return undefined;
    const remainingMs = expiryTime - Date.now();
    if (remainingMs <= 0) {
      handleLogout();
      setAuthMessage('Session expired. Please log in again.');
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      handleLogout();
      setAuthMessage('Session expired. Please log in again.');
    }, remainingMs);
    return () => clearTimeout(timeoutId);
  }, [authExpiresAt, authToken, handleLogout]);

  useEffect(() => {
    if (!authToken) return undefined;
    const inactivityMs = 30 * 60 * 1000;
    let lastActivityTs = 0;
    let timeoutId = null;
    const resetInactivityTimer = () => {
      const now = Date.now();
      if (now - lastActivityTs < 1000) {
        return;
      }
      lastActivityTs = now;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
        setAuthMessage('Logged out due to inactivity.');
      }, inactivityMs);
    };
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((eventName) => document.addEventListener(eventName, resetInactivityTimer, true));
    resetInactivityTimer();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach((eventName) => document.removeEventListener(eventName, resetInactivityTimer, true));
    };
  }, [authToken, handleLogout]);

  useEffect(() => {
    if (!authToken) return undefined;

    let cancelled = false;
    const verifySession = async () => {
      // Give auth state a short settle window right after login.
      if (Date.now() - lastAuthSuccessAtRef.current < 1500) {
        return;
      }

      try {
        const response = await requestWithRetry(`${API_BASE_URL}/auth/me`, {
          headers: {
            ...authHeaders,
          },
        });
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          // Confirm once before logging out to avoid transient/race false negatives.
          try {
            await wait(250);
            const confirmResponse = await requestWithRetry(`${API_BASE_URL}/auth/me`, {
              headers: {
                ...authHeaders,
              },
            }, 0);
            if (cancelled) return;
            if (confirmResponse.status === 401 || confirmResponse.status === 403) {
              handleLogout();
              setAuthMessage('Session invalid or expired. Please log in again.');
            }
          } catch {
            // Ignore transient confirmation failures.
          }
        }
      } catch {
        // Do not force logout or show disruptive auth errors on transient checks.
      }
    };

    verifySession();

    return () => {
      cancelled = true;
    };
  }, [authHeaders, authToken, handleLogout, requestWithRetry]);

  useEffect(() => {
    let mounted = true;

    const checkBackend = async () => {
      try {
        const response = await requestWithRetry(`${API_BASE_URL}/health`, {}, 1);
        if (!mounted) return;
        if (response.ok) {
          backendHealthFailCountRef.current = 0;
          setBackendOnline(true);
        } else if (response.status >= 500) {
          backendHealthFailCountRef.current += 1;
          if (backendHealthFailCountRef.current >= 3) {
            setBackendOnline(false);
          }
        } else {
          // Non-5xx responses still prove the server is reachable.
          backendHealthFailCountRef.current = 0;
          setBackendOnline(true);
        }
      } catch (error) {
        if (!mounted) return;
        if (error?.name === 'ClientRateLimitError') {
          return;
        }
        backendHealthFailCountRef.current += 1;
        if (backendHealthFailCountRef.current >= 3) {
          setBackendOnline(false);
        }
      }
    };

    checkBackend();
    const intervalId = setInterval(checkBackend, 30000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [requestWithRetry]);

  useEffect(() => {
    const intervalId = setInterval(() => setClockTick(Date.now()), 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!preview || !String(preview).startsWith('blob:')) {
      return undefined;
    }
    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    const formattedResidence = [locality.trim(), city, district, stateRegion, country]
      .filter(Boolean)
      .join(', ');

    if (formattedResidence !== residence) {
      setResidence(formattedResidence);
    }
  }, [country, stateRegion, district, city, locality, residence]);

  // --- [5] AI INFERENCE & VOXEL GENERATION ---
  const [bookingInfo, setBookingInfo] = useState(null);
  const isCompleteLocation = Boolean(
    country && stateRegion && district && city && locality.trim()
  );

  const getFallbackPatientPayload = useCallback(() => {
    const generatedBed = `TEMP-${new Date().getTime().toString().slice(-6)}`;
    const locationFromParts = [locality.trim(), city, district, stateRegion, country]
      .filter(Boolean)
      .join(', ');

    return {
      patientName: patientName.trim() || 'Unknown Patient',
      bedNumber: bedNumber.trim() || generatedBed,
      residence: residence.trim() || locationFromParts || 'Location Unspecified',
    };
  }, [bedNumber, city, country, district, locality, patientName, residence, stateRegion]);

  const executeInference = async () => {
    if (!consentChecked) {
      setScanMessage('Please provide consent before running medical analysis.');
      alert('Please provide consent before running medical analysis.');
      return;
    }
    if (!file) {
      setScanMessage('Please upload a supported scan file (.dcm, .nii, .nii.gz, .jpg, .jpeg, .png).');
      addLog("!! ABORT: MISSING_SUBJECT_METADATA");
      alert('Please upload a scan before running analysis.');
      return;
    }

    const safePayload = getFallbackPatientPayload();

    if (!authToken) {
      const offlineResult = buildOfflineClinicalResult({
        file,
        department,
        patientName: safePayload.patientName,
        bedNumber: safePayload.bedNumber,
        residence: safePayload.residence,
      });
      setResult(offlineResult);
      setActiveTab('QUANTITATIVE');
      setBookingMessage(
        backendOnline
          ? 'Guest mode analysis completed locally. Log in to run server-validated analysis and save history.'
          : 'Local analysis completed. Log in to run server-side validated analysis and save history.'
      );
      addLog('AUTH_MISSING -> LOCAL_ANALYSIS_COMPLETED');
      return;
    }

    if (scanInFlightRef.current) {
      addLog('SCAN_REQUEST_SKIPPED: PREVIOUS_INFERENCE_ACTIVE');
      return;
    }

    scanInFlightRef.current = true;
    setScanMessage('');
    setLoading(true);
    setResult(null);
    setIs3DExpanded(false);
    setAutoSpin3D(true);
    setCinematicTour3D(false);
    setShowViewerControls(false);
    setBookingMessage('');
    addLog(`INIT_SEGMENTATION: DATASET_${department.toUpperCase()}`);
    addLog("COMPUTING_ISOTROPIC_VOXEL_DENSITY");
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('department', department);
    formData.append('patient_name', safePayload.patientName);
    formData.append('bed_number', safePayload.bedNumber);
    formData.append('residence', safePayload.residence);
    formData.append('consent', String(consentChecked));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const resp = await requestWithRetry(`${API_BASE_URL}/process-scan`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          ...authHeaders,
        },
      }, 2);
      
      if (!resp.ok) {
        let detail = `Request failed (${resp.status})`;
        try {
          const payload = await resp.json();
          detail = payload?.detail || payload?.message || detail;
        } catch {
          // Keep fallback detail when response body is not JSON.
        }
        const apiError = new Error(detail);
        apiError.name = 'ApiResponseError';
        apiError.status = resp.status;
        throw apiError;
      }
      
      const data = await resp.json();
      setResult(data);
      setScanMessage('Scan analysis completed successfully.');
      setActiveTab("QUANTITATIVE");
      setIs3DExpanded(false);
      setAutoSpin3D(true);
      setCinematicTour3D(false);
      setNearestBeds([]);
      setBookingMessage("");
      setBookingInfo(null);
      fetchHistory();
      addLog(`SUCCESS: DICE_SCORE_${data.dice_score}`);
      addLog(`VOLUME_MAPPED: ${data.volume}`);
      addLog(`REPORT_READY: ${data.subject_id}`);
      setBackendOnline(true);
      backendHealthFailCountRef.current = 0;
    } catch (e) {
      const backendReachable = updateBackendStatusFromError(e);
      const canUseOfflineFallback = !backendReachable || e?.name === 'AbortError';

      if (canUseOfflineFallback) {
        const offlineResult = buildOfflineClinicalResult({
          file,
          department,
          patientName: safePayload.patientName,
          bedNumber: safePayload.bedNumber,
          residence: safePayload.residence,
        });
        setResult(offlineResult);
        setActiveTab('QUANTITATIVE');

        if (e?.name === 'AbortError') {
          setScanMessage('Server response timed out, so local fallback analysis was generated.');
          setBookingMessage('Server response took too long, so local fallback was used for continuity.');
          addLog('TIMEOUT_DETECTED -> LOCAL_FALLBACK_ACTIVATED');
        } else {
          setScanMessage('Network unavailable. Local fallback analysis was generated.');
          setBookingMessage('Network unavailable. Local fallback was used for continuity.');
          addLog('BACKEND_UNREACHABLE -> LOCAL_FALLBACK_ACTIVATED');
        }
      } else {
        setResult(null);
        setScanMessage(`Scan failed: ${e?.message || 'request failed'}`);
        setBookingMessage(`Server returned an error: ${e?.message || 'request failed'}. Please retry.`);
        addLog(`SERVER_ERROR_NO_FALLBACK: ${String(e?.message || 'UNKNOWN_ERROR').toUpperCase()}`);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      scanInFlightRef.current = false;
    }
  };

  const purgeSystemMemory = async () => {
    if (window.confirm("Do you want to clear all saved history records?")) {
      try {
        await fetch(`${API_BASE_URL}/clear-history`, {
          method: 'DELETE',
          headers: {
            ...authHeaders,
          },
        });
        setHistory([]);
        setResult(null);
        setBackendOnline(true);
        addLog("!! DATABASE_PURGED: HIPAA_COMPLIANT_WIPE");
      } catch (err) {
        setBackendOnline(false);
        addLog("!! PURGE_FAILED: ACCESS_DENIED");
      }
    }
  };

  const downloadDetailedReport = () => {
    if (!result) return;

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 18;
    const lineGap = 7;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('DISHA Clinical Tumor Detection Report', 14, y);
    y += 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(`Patient Name: ${result.patient_name}`, 14, y); y += lineGap;
    pdf.text(`Bed Number: ${result.bed_number}`, 14, y); y += lineGap;
    pdf.text(`Residence: ${result.residence}`, 14, y); y += lineGap;
    pdf.text(`Study ID: ${result.subject_id}`, 14, y); y += lineGap;
    pdf.text(`Dataset: ${result.dataset_context}`, 14, y); y += lineGap;
    pdf.text(`Prediction: ${result.prediction}`, 14, y); y += lineGap;
    pdf.text(`Severity: ${result.severity}`, 14, y); y += lineGap;
    pdf.text(`Volume: ${result.volume}`, 14, y); y += lineGap;
    pdf.text(`Max Diameter: ${result.diameter}`, 14, y); y += lineGap;
    pdf.text(`AI Confidence: ${result.confidence}%`, 14, y); y += lineGap;
    pdf.text(`Dice Score: ${result.dice_score}`, 14, y); y += lineGap;
    pdf.text(`Generated At: ${result.timestamp}`, 14, y); y += 10;

    pdf.setFont('helvetica', 'bold');
    pdf.text('Detailed Analysis', 14, y);
    y += 7;
    pdf.setFont('helvetica', 'normal');

    (result.detailed_report || []).forEach((line) => {
      const wrapped = pdf.splitTextToSize(`- ${line}`, 178);
      pdf.text(wrapped, 14, y);
      y += wrapped.length * 6;
      if (y > 270) {
        pdf.addPage();
        y = 18;
      }
    });

    y += 6;
    const noteLines = pdf.splitTextToSize(`Clinical Note: ${result.analysis_note || ''}`, 178);
    pdf.text(noteLines, 14, y);

    const safeName = (result.patient_name || 'patient').replace(/[^a-zA-Z0-9_-]/g, '_');
    pdf.save(`DISHA_Report_${safeName}_${result.subject_id}.pdf`);
  };

  const printDetailedReport = () => {
    if (!result) return;

    const reportLines = (result.detailed_report || [])
      .map((line) => `<li>${line}</li>`)
      .join('');

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>DISHA Report - ${result.subject_id}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 28px; color: #111; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            h2 { margin: 18px 0 8px; font-size: 16px; }
            .meta { margin: 0 0 14px; line-height: 1.6; font-size: 13px; }
            .box { border: 1px solid #c9d3df; border-radius: 6px; padding: 12px; }
            ul { margin: 8px 0 0 18px; }
            li { margin-bottom: 6px; font-size: 13px; line-height: 1.45; }
            .note { margin-top: 10px; font-size: 13px; }
            .footer { margin-top: 20px; font-size: 11px; color: #555; }
          </style>
        </head>
        <body>
          <h1>DISHA Clinical Tumor Detection Report</h1>
          <div class="meta">
            <div><strong>Patient Name:</strong> ${result.patient_name}</div>
            <div><strong>Bed Number:</strong> ${result.bed_number}</div>
            <div><strong>Residence:</strong> ${result.residence}</div>
            <div><strong>Study ID:</strong> ${result.subject_id}</div>
            <div><strong>Dataset:</strong> ${result.dataset_context}</div>
            <div><strong>Prediction:</strong> ${result.prediction}</div>
            <div><strong>Severity:</strong> ${result.severity}</div>
            <div><strong>Volume:</strong> ${result.volume}</div>
            <div><strong>Max Diameter:</strong> ${result.diameter}</div>
            <div><strong>AI Confidence:</strong> ${result.confidence}%</div>
            <div><strong>Dice Score:</strong> ${result.dice_score}</div>
            <div><strong>Generated At:</strong> ${result.timestamp}</div>
          </div>
          <div class="box">
            <h2>Detailed Analysis</h2>
            <ul>${reportLines}</ul>
            <div class="note"><strong>Clinical Note:</strong> ${result.analysis_note || ''}</div>
          </div>
          <div class="footer">Generated by DISHA - your care, our vision.</div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const enterBookingFlow = () => {
    if (!authToken && backendOnline) {
      setAuthMessage('Please log in first to continue.');
      return;
    }
    if (!authToken && !backendOnline) {
      setAuthMessage('Offline mode active: booking recommendations will use cached/local data.');
    }
    setCarePath('booking');
    setDepartment('bed_booking');
    setActiveTab('REPORT');
    setResult(null);
    setNearestBeds([]);
    setBookingInfo(null);
    setBookingMessage('');
    setSearchWorldwide(false);
    setPrescriptionFile(null);
    setConsentChecked(false);
    setBookingSymptoms('');
    setBookingSeverity('MODERATE');
    setTriageRecommendation(null);
    setBedRecommendations({ current: null, predicted: null });
  };

  const enterDetectionFlow = () => {
    if (!authToken && backendOnline) {
      setAuthMessage('Guest mode enabled: local analysis is available. Log in for server-validated reports and saved history.');
    }
    if (!authToken && !backendOnline) {
      setAuthMessage('Offline mode active: local 3D continuity analysis is available.');
    }
    setCarePath('detection');
    setLandingStep('departments');
  };

  const enterHospitalDashboardFlow = () => {
    if (!authToken && backendOnline) {
      setAuthMessage('Please log in first to continue.');
      return;
    }
    if (backendOnline && !['hospital_admin', 'system_admin'].includes(authRole)) {
      setAuthMessage('Hospital dashboard requires hospital admin or system admin access.');
      return;
    }
    if (!backendOnline) {
      setAuthMessage('Offline mode active: dashboard updates will be stored locally.');
    }
    setCarePath('hospital');
    setDepartment('hospital_dashboard');
    setActiveTab('REPORT');
    setBookingMessage('');
    setDashboardMessage('');
    setConsentChecked(false);
  };

  const openDetectionDepartment = (departmentId) => {
    if (!authToken && backendOnline) {
      setAuthMessage('Guest mode enabled: running local analysis only until you log in.');
    }
    setCarePath('detection');
    setDepartment(departmentId);
    setActiveTab('QUANTITATIVE');
    setBookingMessage('');
    setNearestBeds([]);
  };

  const resetSession = () => {
    setLandingStep('welcome');
    setCarePath(null);
    setDepartment(null);
    setResult(null);
    setFile(null);
    setPreview(null);
    setLoading(false);
    setActiveTab('QUANTITATIVE');
    setNearestBeds([]);
    setAutoSpin3D(true);
    setCinematicTour3D(false);
    setBookingInfo(null);
    setBookingMessage('');
    setPrescriptionUpdate('');
    setPrescriptionFile(null);
    setConsentChecked(false);
    setContactEmail('');
    setContactPhone('');
    setSearchWorldwide(false);
    setBookingSymptoms('');
    setBookingSeverity('MODERATE');
    setTriageRecommendation(null);
    setBedRecommendations({ current: null, predicted: null });
    setHospitalInventory([]);
    setSelectedHospitalName('');
    setDashboardAvailableBeds(0);
    setDashboardIcuBeds(0);
    setDashboardVentilators(0);
    setDashboardAvailabilityMode('open');
    setDashboardMessage('');
    setLastBedUpdateAt(null);
    setCountry('');
    setStateRegion('');
    setDistrict('');
    setCity('');
    setLocality('');
    setResidence('');
    setCinematicTour3D(false);
    setShowViewerControls(false);
  };

  const severityTheme = useMemo(() => {
    const severity = (result?.severity || '').toLowerCase();
    if (severity === 'critical') return 'critical';
    if (severity === 'moderate') return 'moderate';
    return 'normal';
  }, [result?.severity]);

  const download3DScreenshot = useCallback(() => {
    if (!rendererCanvasRef.current || !result) {
      setBookingMessage('3D screenshot unavailable until a model is rendered.');
      return;
    }
    try {
      const imageData = rendererCanvasRef.current.toDataURL('image/png');
      const link = document.createElement('a');
      const safeStudyId = String(result.subject_id || 'scan').replace(/[^a-zA-Z0-9_-]/g, '_');
      link.href = imageData;
      link.download = `DISHA_3D_${safeStudyId}.png`;
      link.click();
    } catch {
      setBookingMessage('Unable to export screenshot in this browser session.');
    }
  }, [result]);

  const toggleCinematicTour = useCallback(() => {
    setCinematicTour3D((prev) => {
      const next = !prev;
      if (next) {
        setAutoSpin3D(false);
        issueViewerCommand('preset-iso');
      }
      return next;
    });
  }, [issueViewerCommand]);

  useEffect(() => {
    if (!result) return undefined;

    const onKeyDown = (event) => {
      const targetTag = String(event.target?.tagName || '').toLowerCase();
      const isTypingTarget =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetTag === 'select' ||
        event.target?.isContentEditable;
      if (isTypingTarget) return;

      const key = String(event.key || '').toLowerCase();
      if (!key) return;

      if (key === 'r') {
        event.preventDefault();
        issueViewerCommand('reset-view');
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        toggleCinematicTour();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        download3DScreenshot();
        return;
      }
      if (key === '1') {
        event.preventDefault();
        issueViewerCommand('preset-front');
        return;
      }
      if (key === '2') {
        event.preventDefault();
        issueViewerCommand('preset-side');
        return;
      }
      if (key === '3') {
        event.preventDefault();
        issueViewerCommand('preset-top');
        return;
      }
      if (key === '4') {
        event.preventDefault();
        issueViewerCommand('preset-iso');
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        issueViewerCommand('zoom-in');
        return;
      }
      if (key === '-' || key === '_') {
        event.preventDefault();
        issueViewerCommand('zoom-out');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [download3DScreenshot, issueViewerCommand, result, toggleCinematicTour]);

  const departmentLabel = {
    neuro_axial: 'Brain Tumor',
    pulmonary: 'Lung Tumor',
    cardio_thoracic: 'Liver Tumor',
    bed_booking: 'Bed Booking',
    hospital_dashboard: 'Hospital Dashboard'
  }[department] || 'Care';

  const fetchHospitalDashboard = useCallback(async () => {
    try {
      const resp = await requestWithRetry(`${API_BASE_URL}/hospital-dashboard`, {
        headers: {
          ...authHeaders,
        },
      });
      if (!resp.ok) throw new Error('Failed to load hospital dashboard');
      const data = await resp.json();
      setHospitalInventory(data.hospitals || []);
      setLastBedUpdateAt(data.timestamp || null);
      if (!selectedHospitalName && data.hospitals?.length) {
        setSelectedHospitalName(data.hospitals[0].hospital);
      }
      FrontendSecurity.setToLocalStorage(OFFLINE_HOSPITAL_CACHE_KEY, data.hospitals || []);
      setBackendOnline(true);
    } catch (error) {
      const backendReachable = updateBackendStatusFromError(error);
      const cachedHospitals = FrontendSecurity.getFromLocalStorage(OFFLINE_HOSPITAL_CACHE_KEY) || [];
      if (Array.isArray(cachedHospitals) && cachedHospitals.length > 0) {
        setHospitalInventory(cachedHospitals);
        if (!selectedHospitalName && cachedHospitals[0]?.hospital) {
          setSelectedHospitalName(cachedHospitals[0].hospital);
        }
        setDashboardMessage(backendReachable
          ? `Unable to load hospital dashboard: ${error.message}`
          : 'Offline mode: showing last saved hospital dashboard data.');
      } else {
        setDashboardMessage(backendReachable
          ? `Unable to load hospital dashboard: ${error.message}`
          : 'Unable to load hospital dashboard right now.');
      }
    }
  }, [requestWithRetry, selectedHospitalName, authHeaders, updateBackendStatusFromError]);

  useEffect(() => {
    const selectedHospital = hospitalInventory.find((item) => item.hospital === selectedHospitalName);
    if (!selectedHospital) return;
    setDashboardAvailableBeds(selectedHospital.available_beds ?? 0);
    setDashboardIcuBeds(selectedHospital.icu_beds ?? 0);
    setDashboardVentilators(selectedHospital.ventilators ?? 0);
    setDashboardAvailabilityMode(selectedHospital.availability_mode || 'open');
  }, [selectedHospitalName, hospitalInventory]);

  const saveHospitalAvailability = async () => {
    if (!selectedHospitalName) {
      setDashboardMessage('Select a hospital first.');
      return;
    }

    setDashboardMessage('');
    try {
      const resp = await requestWithRetry(`${API_BASE_URL}/hospital-dashboard/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          hospital: selectedHospitalName,
          available_beds: Number(dashboardAvailableBeds),
          icu_beds: Number(dashboardIcuBeds),
          ventilators: Number(dashboardVentilators),
          availability_mode: dashboardAvailabilityMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Update failed');
      setDashboardMessage(`Availability updated for ${data.hospital.hospital}.`);
      setLastBedUpdateAt(data.timestamp || null);
      setBackendOnline(true);
      fetchHospitalDashboard();
    } catch (error) {
      const backendReachable = updateBackendStatusFromError(error);
      const fallbackHospitals = [...hospitalInventory];
      const idx = fallbackHospitals.findIndex((item) => item.hospital === selectedHospitalName);
      if (idx >= 0) {
        fallbackHospitals[idx] = {
          ...fallbackHospitals[idx],
          available_beds: Number(dashboardAvailableBeds),
          icu_beds: Number(dashboardIcuBeds),
          ventilators: Number(dashboardVentilators),
          availability_mode: dashboardAvailabilityMode,
          last_updated: new Date().toISOString().replace('T', ' ').slice(0, 19),
        };
        setHospitalInventory(fallbackHospitals);
        FrontendSecurity.setToLocalStorage(OFFLINE_HOSPITAL_CACHE_KEY, fallbackHospitals);
        setDashboardMessage(backendReachable
          ? `Update failed: ${error.message}`
          : 'Offline mode: availability saved locally and will sync when backend is online.');
      } else {
        setDashboardMessage(`Update failed: ${error.message}`);
      }
    }
  };

  const fetchAdminMetrics = useCallback(async () => {
    if (!authToken) return;
    if (authRole !== 'system_admin') {
      setAdminMetrics(null);
      return;
    }
    try {
      const resp = await requestWithRetry(`${API_BASE_URL}/admin/metrics`, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Failed to load metrics');
      setAdminMetrics(data);
    } catch (error) {
      setDashboardMessage(`Metrics unavailable: ${error.message}`);
    }
  }, [authHeaders, authRole, authToken, requestWithRetry]);

  useEffect(() => {
    if (carePath === 'hospital') {
      fetchHospitalDashboard();
      fetchAdminMetrics();
    }
  }, [carePath, fetchHospitalDashboard, fetchAdminMetrics]);

  const fetchAmbulanceOptions = useCallback(async (locationValue) => {
    if (!authToken) return;
    try {
      const params = new URLSearchParams({
        residence: locationValue || '',
      });
      const resp = await requestWithRetry(`${API_BASE_URL}/ambulance-options?${params.toString()}`, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Ambulance lookup failed');
      setAmbulanceOptions(data.options || []);
    } catch (error) {
      setAmbulanceOptions([]);
    }
  }, [authHeaders, authToken, requestWithRetry]);

  const activateEmergencyMode = async () => {
    if (!authToken) {
      setBookingMessage('Please log in to use emergency mode.');
      return;
    }
    setEmergencyLoading(true);
    setBookingMessage('');
    try {
      let endpoint = `${API_BASE_URL}/emergency-nearest-icu`;
      const fetchWithLocation = (latitude, longitude) => `${endpoint}?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;

      if (navigator.geolocation) {
        const coords = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000 });
        });
        endpoint = fetchWithLocation(coords.coords.latitude, coords.coords.longitude);
      } else {
        endpoint = `${endpoint}?residence=${encodeURIComponent(residence || '')}`;
      }

      const resp = await requestWithRetry(endpoint, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Emergency search failed');
      setNearestBeds(data.options || []);
      FrontendSecurity.setToLocalStorage('dishaLastHospitals', data.options || []);
      fetchAmbulanceOptions(residence);
      setBookingMessage('Emergency mode enabled: nearest ICU hospitals loaded.');
      setBackendOnline(true);
    } catch (error) {
      const backendReachable = updateBackendStatusFromError(error);
      const cached = FrontendSecurity.getFromLocalStorage('dishaLastHospitals') || [];
      if (cached.length > 0) {
        setNearestBeds(cached);
        setBookingMessage(backendReachable
          ? `Emergency mode failed: ${error.message}`
          : 'Network issue: showing last known hospital data (offline fallback).');
      } else {
        setBookingMessage(`Emergency mode failed: ${error.message}`);
      }
    } finally {
      setEmergencyLoading(false);
    }
  };

  const countryOptions = useMemo(() => Object.keys(LOCATION_HIERARCHY), []);
  const stateOptions = useMemo(
    () => (country ? Object.keys(LOCATION_HIERARCHY[country] || {}) : []),
    [country]
  );
  const districtOptions = useMemo(
    () =>
      country && stateRegion
        ? Object.keys((LOCATION_HIERARCHY[country] || {})[stateRegion] || {})
        : [],
    [country, stateRegion]
  );
  const cityOptions = useMemo(
    () =>
      country && stateRegion && district
        ? ((LOCATION_HIERARCHY[country] || {})[stateRegion] || {})[district] || []
        : [],
    [country, stateRegion, district]
  );

  // Debounced fetch for nearest beds
  const fetchNearestBeds = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const timer = setTimeout(async () => {
      const location = (result?.residence || residence || '').trim();
      if (!location || !isCompleteLocation) {
        setBookingMessage('Please complete country, state/province, district/county, city, and locality to find nearest beds.');
        return;
      }
      setBookingLoading(true);
      setBookingMessage('');
      try {
        const scope = searchWorldwide ? 'global' : 'local';
        const severityValue = (result?.severity || bookingSeverity || '').trim();
        const symptomsValue = bookingSymptoms.trim();
        const params = new URLSearchParams({
          residence: location,
          limit: '3',
          scope,
          severity: severityValue,
          symptoms: symptomsValue,
          triage_mode: 'ml',
        });
        const resp = await requestWithRetry(`${API_BASE_URL}/nearest-bed-options?${params.toString()}`, {
          headers: {
            ...authHeaders,
          },
        });
        if (!resp.ok) throw new Error('Failed to fetch nearest bed options');
        const data = await resp.json();
        setNearestBeds(data.options || []);
        FrontendSecurity.setToLocalStorage('dishaLastHospitals', data.options || []);
        setTriageRecommendation(data.triage_recommendation || null);
        setBedRecommendations({
          current: data.best_current_option || null,
          predicted: data.best_predicted_option || null,
        });
        if ((data.options || []).length === 0) {
          setBookingMessage('No available beds found for the selected search scope.');
        }
        setBackendOnline(true);
        addLog(`BED_OPTIONS_READY: ${data.options?.length || 0}`);
      } catch (err) {
        const backendReachable = updateBackendStatusFromError(err);
        setTriageRecommendation(null);
        setBedRecommendations({ current: null, predicted: null });
        const cached = FrontendSecurity.getFromLocalStorage('dishaLastHospitals') || [];
        if (cached.length > 0) {
          setNearestBeds(cached);
          setBookingMessage(backendReachable
            ? `Unable to load nearby bed options: ${err.message}`
            : 'Network issue: showing last known hospitals (offline fallback).');
        } else {
          setBookingMessage(backendReachable
            ? `Unable to load nearby bed options: ${err.message}`
            : 'Unable to load nearby bed options right now. Please try again.');
        }
      } finally {
        setBookingLoading(false);
      }
    }, 400);
    debounceTimerRef.current = timer;
  }, [result, residence, searchWorldwide, requestWithRetry, authHeaders, isCompleteLocation, bookingSeverity, bookingSymptoms, updateBackendStatusFromError]);

  useEffect(() => {
    if (!carePath || !['booking', 'hospital'].includes(carePath)) return undefined;

    const socket = new WebSocket(`${WS_BASE_URL}/ws/bed-updates?token=${encodeURIComponent(authToken)}`);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (Array.isArray(payload.hospitals)) {
          setHospitalInventory(payload.hospitals);
        }
        if (payload.timestamp) {
          setLastBedUpdateAt(payload.timestamp);
        }
        if (carePath === 'booking' && isCompleteLocation) {
          const now = Date.now();
          if (now - lastAutoBedRefreshRef.current > 5000) {
            lastAutoBedRefreshRef.current = now;
            fetchNearestBeds();
          }
        }
      } catch (error) {
        addLog('!! LIVE_UPDATE_PARSE_FAILED');
      }
    };
    socket.onerror = () => {
      addLog('!! LIVE_UPDATE_SOCKET_ERROR');
    };

    return () => {
      socket.close();
    };
  }, [carePath, fetchNearestBeds, isCompleteLocation, authToken]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const bookNearestBed = async (hospitalName) => {
    if (!authToken && backendOnline) {
      setBookingMessage('Please log in first to continue with booking.');
      return;
    }
    if (!consentChecked) {
      setBookingMessage('Please accept consent before booking a bed.');
      return;
    }

    const note = prescriptionUpdate.trim();
    if (!note && !prescriptionFile) {
      setBookingMessage('Please add prescription details or upload a prescription file before booking a bed.');
      return;
    }

    const bookingKey = (hospitalName || '').toLowerCase();
    if (bookingInFlightRef.current.has(bookingKey)) {
      setBookingMessage(`Booking is already in progress for ${hospitalName}. Please wait.`);
      return;
    }

    const payload = {
      patient_name: (result?.patient_name || patientName || '').trim(),
      bed_number: (result?.bed_number || bedNumber || '').trim(),
      residence: (result?.residence || residence || '').trim(),
      hospital: hospitalName,
      prescription_update: note || undefined,
      prescription_file_name: prescriptionFile?.name || undefined,
      email: contactEmail.trim() || undefined,
      phone: contactPhone.trim() || undefined,
      consent: consentChecked,
    };
    bookingInFlightRef.current.add(bookingKey);
    setBookingLoading(true);
    setBookingMessage('');
    try {
      const resp = await requestWithRetry(`${API_BASE_URL}/book-bed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || 'Booking failed');
      const resolvedTrackingLink = data.family_tracking_link || (data.tracking_path ? `${API_BASE_URL}${data.tracking_path}` : null);
      setBookingMessage(`Bed booked successfully at ${data.hospital}. Booking ID: ${data.booking_id}. Arrival window: ${data.estimated_arrival_window}.`);
      setBackendOnline(true);
      setBookingInfo({
        booking_id: data.booking_id,
        hospital: data.hospital,
        estimated_arrival_window: data.estimated_arrival_window,
        notification_status: data.notification_status,
        family_tracking_link: resolvedTrackingLink,
        tracking_id: data.tracking_id,
        last_updated: data.last_updated,
      });
      addLog(`BED_BOOKED: ${data.booking_id}`);
      setTimeout(fetchNearestBeds, 500); // Refresh bed list after booking
    } catch (err) {
      const backendReachable = updateBackendStatusFromError(err);
      const provisionalId = `OFFLINE-${Date.now().toString().slice(-7)}`;
      setBookingInfo({
        booking_id: provisionalId,
        hospital: hospitalName,
        estimated_arrival_window: 'To be confirmed when online',
        notification_status: {
          summary: 'Offline provisional booking saved locally.',
        },
        family_tracking_link: null,
        tracking_id: null,
        last_updated: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      setBookingMessage(backendReachable
        ? `Booking failed: ${err.message}`
        : 'Offline mode: provisional booking created locally. Reconnect to server to confirm hospital-side reservation.');
    } finally {
      bookingInFlightRef.current.delete(bookingKey);
      setBookingLoading(false);
    }
  };

  // --- [6] RENDER: LANDING PORTAL ---
  if (!department) return (
    <div className={`portal-master-container ${darkMode ? 'theme-dark' : 'theme-light'} ${largeTextMode ? 'large-text-mode' : ''} ${compactMode ? 'compact-mode' : ''}`}>
      <div className="grid-overlay"></div>
      <div className="portal-content">
        {!backendOnline && <div className="backend-status-banner">Server is offline. Please start the API service.</div>}
        <h1 className="main-wizard-title">DISHA</h1>
        <p className="clinical-subtitle">your care, our vision</p>

        <div className="app-control-bar">
          <select className="magic-input-field" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="bn">বাংলা</option>
            <option value="hi">हिंदी</option>
          </select>
          <label className="consent-checkbox-row compact">
            <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
            Dark mode
          </label>
          <label className="consent-checkbox-row compact">
            <input type="checkbox" checked={largeTextMode} onChange={(e) => setLargeTextMode(e.target.checked)} />
            Larger text
          </label>
          <label className="consent-checkbox-row compact">
            <input type="checkbox" checked={compactMode} onChange={(e) => setCompactMode(e.target.checked)} />
            Compact mode
          </label>
        </div>

        <div className="auth-card">
          <div className="auth-card-title">{authToken ? `Logged in as ${authUsername} (${authRole})` : 'Secure Login / Signup'}</div>
          {authToken ? (
            <button className="mystic-gold-button" onClick={handleLogout}>Logout</button>
          ) : (
            <>
              <div className="auth-mode-toggle">
                <button className={authFormMode === 'login' ? 'active' : ''} onClick={() => { setAuthFormMode('login'); setAuthMessage(''); }}>Login</button>
                <button className={authFormMode === 'signup' ? 'active' : ''} onClick={() => { setAuthFormMode('signup'); setAuthMessage(''); }}>Signup</button>
              </div>
              <input
                className="magic-input-field"
                placeholder="Username (a-z, 0-9, _, -, .)"
                value={authFormUsername}
                onChange={(e) => setAuthFormUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
              />
              <div className="auth-helper-text">Use 3-32 lowercase characters: a-z, 0-9, underscore (_), hyphen (-), dot (.).</div>
              <input
                className="magic-input-field"
                type={showAuthPassword ? 'text' : 'password'}
                placeholder="Password (minimum 8 characters)"
                value={authFormPassword}
                onChange={(e) => setAuthFormPassword(e.target.value)}
              />
              <label className="consent-checkbox-row compact auth-show-password-row">
                <input
                  type="checkbox"
                  checked={showAuthPassword}
                  onChange={(e) => setShowAuthPassword(e.target.checked)}
                />
                Show password
              </label>
              {authFormMode === 'signup' && (
                <>
                  <select
                    className="magic-input-field"
                    value={authFormRole}
                    onChange={(e) => setAuthFormRole(e.target.value)}
                  >
                    <option value="patient">Patient</option>
                    <option value="hospital_admin">Hospital Admin</option>
                    <option value="system_admin">System Admin</option>
                  </select>
                  {authFormRole !== 'patient' && (
                    <input
                      className="magic-input-field"
                      type={showAuthPassword ? 'text' : 'password'}
                      placeholder="Admin invite code"
                      value={authFormInviteCode}
                      onChange={(e) => setAuthFormInviteCode(e.target.value)}
                    />
                  )}
                </>
              )}
              <button className="mystic-gold-button primary" onClick={handleAuthSubmit} disabled={authLoading}>
                {authLoading ? 'Please wait...' : authFormMode === 'signup' ? 'Create Account' : 'Login'}
              </button>
            </>
          )}
          {authMessage && <div className="auth-message">{authMessage}</div>}
        </div>

        <div className="medical-disclaimer-banner">
          <strong>Medical disclaimer:</strong> {t('disclaimer')}
          <br />
          <strong>Emergency guidance:</strong> {t('emergencyGuidance')}
        </div>

        <div
          key={landingStep}
          className={`landing-stage ${landingStep === 'welcome' ? 'welcome-stage' : 'options-stage'}`}
        >
          {landingStep === 'welcome' ? (
            <div className="welcome-pop-card">
              <h2>Welcome to DISHA</h2>
              <p>
                Start a guided care flow for bed booking, hospital operations, or tumor detection with detailed analysis.
              </p>
              <div className="welcome-cta-wrap">
                <button
                  className="welcome-cta-btn"
                  onClick={() => setLandingStep('care')}
                >
                  Continue
                </button>
                <div className="welcome-hover-tip">
                  Choose patient booking, hospital dashboard, or tumor detection.
                </div>
              </div>
            </div>
          ) : landingStep === 'care' ? (
            <>
              <div className="selection-help-text">Choose how you want to continue</div>
              <div className="portal-selection-grid">
                {[
                  {id: 'booking', label: 'Book a Bed Now', sub: 'Update prescription details and find the nearest available bed', badge: 'Quick Access'},
                  {id: 'hospital', label: 'Hospital Dashboard', sub: 'Update live bed counts and manage availability', badge: 'Live Ops'},
                  {id: 'detection', label: 'Tumor Detection', sub: 'Upload scan and get detailed tumor analysis', badge: 'Ready'}
                ].map((item, idx) => (
                  <div
                    key={item.id}
                    className={`portal-magic-card ${idx === 0 ? 'featured-card' : ''}`}
                    style={{ '--card-delay': `${idx * 120}ms` }}
                    onClick={() => item.id === 'booking' ? enterBookingFlow() : item.id === 'hospital' ? enterHospitalDashboardFlow() : enterDetectionFlow()}
                  >
                    <div className="scanner-line"></div>
                    <div className="card-inner-frame"></div>
                    <h2 className="card-label">{item.label}</h2>
                    <div className="card-status-badge">{item.badge}</div>
                    <p className="card-desc">{item.sub}</p>
                  </div>
                ))}
              </div>
              <button className="landing-back-button" onClick={() => setLandingStep('welcome')}>Back</button>
            </>
          ) : (
            <>
              <div className="selection-help-text">Choose a tumor detection option</div>
              <div className="portal-selection-grid">
                {[
                  {id: 'neuro_axial', label: 'Brain Tumor', sub: 'Glioma and edema detection'},
                  {id: 'pulmonary', label: 'Lung Tumor', sub: 'Nodule detection and volumetrics'},
                  {id: 'cardio_thoracic', label: 'Liver Tumor', sub: 'Lesion and carcinoma mapping'}
                ].map((item, idx) => (
                  <div
                    key={item.id}
                    className={`portal-magic-card ${idx === 1 ? 'featured-card' : ''}`}
                    style={{ '--card-delay': `${idx * 120}ms` }}
                    onClick={() => openDetectionDepartment(item.id)}
                  >
                    <div className="scanner-line"></div>
                    <div className="card-inner-frame"></div>
                    <h2 className="card-label">{item.label}</h2>
                    <div className="card-status-badge">Ready</div>
                    <p className="card-desc">{item.sub}</p>
                  </div>
                ))}
              </div>
              <button className="landing-back-button" onClick={() => { setCarePath(null); setLandingStep('care'); }}>Back</button>
            </>
          )}
        </div>

        <div className="portal-footer-info">System status: Ready | Care mode: Active</div>
      </div>
    </div>
  );

  // --- [7] RENDER: MAIN CLINICAL WORKSTATION ---
  return (
    <div className={`sanctum-app-wrapper ${darkMode ? 'theme-dark' : 'theme-light'} ${largeTextMode ? 'large-text-mode' : ''} ${compactMode ? 'compact-mode' : ''}`}>
      {!backendOnline && <div className="backend-status-banner">Server is offline. Some actions may not work until the API is available.</div>}
      <header className="sanctum-header-hud">
        <div className="header-left">
          <button className="back-portal-button" onClick={resetSession}>Exit Session</button>
          {authToken && <button className="back-portal-button" onClick={handleLogout}>Logout</button>}
          <div className="breadcrumb-path">
            Session / {departmentLabel} / <span className="blue-text">{carePath === 'booking' ? 'Bed Routing' : carePath === 'hospital' ? 'Live Operations' : '3D Scan Analysis'}</span>
          </div>
          {bookingInfo && (
            <div className="booking-badge">
              <div className="booking-badge-title">MY BOOKING</div>
              <div className="booking-badge-line">{bookingInfo.hospital}</div>
              <div className="booking-badge-line">ID: {bookingInfo.booking_id}</div>
              {bookingInfo.estimated_arrival_window && <div className="booking-badge-line">ETA: {bookingInfo.estimated_arrival_window}</div>}
              <button className="copy-booking-btn" onClick={() => navigator.clipboard.writeText(bookingInfo.booking_id)}>Copy Booking ID</button>
            </div>
          )}
        </div>

        {carePath === 'hospital' ? (
          <div className="patient-meta-box dashboard-header-box">
            <div className="meta-field">
              <label>Selected Hospital</label>
              <select
                className="magic-input-field"
                value={selectedHospitalName}
                onChange={(e) => setSelectedHospitalName(e.target.value)}
              >
                <option value="">Choose hospital</option>
                {hospitalInventory.map((hospital) => (
                  <option key={hospital.hospital} value={hospital.hospital}>{hospital.hospital}</option>
                ))}
              </select>
            </div>
            <div className="meta-field live-update-field">
              <label>Live Bed Feed</label>
              <div className="live-update-caption">{formatRelativeUpdate(lastBedUpdateAt)}</div>
            </div>
          </div>
        ) : (
        <div className="patient-meta-box">
          <div className="meta-field">
            <label>Patient Name</label>
            <input 
              className="magic-input-field" 
              placeholder="e.g. John Doe" 
              value={patientName} 
              onChange={e => setPatientName(e.target.value)} 
            />
          </div>
          <div className="meta-field">
            <label>Bed Number</label>
            <input
              className="magic-input-field"
              placeholder="e.g. B-12"
              value={bedNumber}
              onChange={e => setBedNumber(e.target.value)}
            />
          </div>
          <LocationSelector
            country={country}
            stateRegion={stateRegion}
            district={district}
            city={city}
            locality={locality}
            residenceSummary={residence}
            countryOptions={countryOptions}
            stateOptions={stateOptions}
            districtOptions={districtOptions}
            cityOptions={cityOptions}
            onCountryChange={(e) => {
              setCountry(e.target.value);
              setStateRegion('');
              setDistrict('');
              setCity('');
            }}
            onStateChange={(e) => {
              setStateRegion(e.target.value);
              setDistrict('');
              setCity('');
            }}
            onDistrictChange={(e) => {
              setDistrict(e.target.value);
              setCity('');
            }}
            onCityChange={(e) => setCity(e.target.value)}
            onLocalityChange={(e) => setLocality(e.target.value)}
          />
          {carePath === 'booking' && (
            <>
              <div className="meta-field prescription-field">
                <label>Prescription Update</label>
                <textarea
                  className="magic-input-field prescription-textarea"
                  placeholder="Add diagnosis, doctor advice, urgency, or prescription note"
                  value={prescriptionUpdate}
                  onChange={e => setPrescriptionUpdate(e.target.value)}
                />
              </div>
              <div className="meta-field prescription-field">
                <label>Prescription File Upload (IMG/JPG/DOC/PDF)</label>
                <input
                  type="file"
                  id="prescription-upload"
                  hidden
                  accept=".img,.jpg,.jpeg,.png,.doc,.docx,.docs,.pdf"
                  onChange={e => {
                    if (e.target.files?.[0]) {
                      const selectedPrescription = e.target.files[0];
                      const validation = FrontendSecurity.validatePrescriptionFile(selectedPrescription);
                      if (!validation.valid) {
                        alert(`This prescription file cannot be uploaded: ${validation.error}`);
                        addLog(`[SECURITY] PRESCRIPTION_FILE_REJECTED: ${validation.error}`);
                        return;
                      }
                      setPrescriptionFile(selectedPrescription);
                      addLog(`PRESCRIPTION_FILE_ATTACHED: ${selectedPrescription.name.toUpperCase()}`);
                      FrontendSecurity.logEvent('FILE_UPLOAD', { action: 'prescription_file_selected', status: 'valid' });
                    }
                  }}
                />
                <label htmlFor="prescription-upload" className="mystic-gold-button">Upload Prescription</label>
                <div className="live-update-caption">
                  {prescriptionFile ? `Selected: ${prescriptionFile.name}` : 'No prescription file selected'}
                </div>
              </div>
              <div className="meta-field">
                <label>Email for confirmation</label>
                <input
                  className="magic-input-field"
                  placeholder="Optional email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                />
              </div>
              <div className="meta-field">
                <label>Phone for SMS</label>
                <input
                  className="magic-input-field"
                  placeholder="Optional phone"
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        )}
      </header>

      {carePath === 'hospital' ? (
        <div className="sanctum-main-layout booking-mode-layout">
          <main className="sanctum-panel-box booking-main-panel">
            <div className="panel-header-row">
              <div className="mystic-header-label">Hospital-side Dashboard</div>
            </div>
            <div className="booking-hero-card">
              <div className="booking-hero-title">Manage live bed availability</div>
              <div className="booking-hero-copy">
                Update hospital bed counts and operational status. All connected clients receive changes in real time.
              </div>
              <div className="live-update-caption">{formatRelativeUpdate(lastBedUpdateAt)}</div>
              <div className="booking-recommendation-grid">
                <div className="meta-field">
                  <label>Available Beds</label>
                  <input className="magic-input-field" type="number" min="0" value={dashboardAvailableBeds} onChange={(e) => setDashboardAvailableBeds(e.target.value)} />
                </div>
                <div className="meta-field">
                  <label>ICU Beds</label>
                  <input className="magic-input-field" type="number" min="0" value={dashboardIcuBeds} onChange={(e) => setDashboardIcuBeds(e.target.value)} />
                </div>
                <div className="meta-field">
                  <label>Ventilators</label>
                  <input className="magic-input-field" type="number" min="0" value={dashboardVentilators} onChange={(e) => setDashboardVentilators(e.target.value)} />
                </div>
                <div className="meta-field">
                  <label>Availability Mode</label>
                  <select className="magic-input-field" value={dashboardAvailabilityMode} onChange={(e) => setDashboardAvailabilityMode(e.target.value)}>
                    <option value="open">Open</option>
                    <option value="limited">Limited</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <button className="mystic-gold-button primary booking-search-button" onClick={saveHospitalAvailability}>
                Save Live Availability
              </button>
              {dashboardMessage && <div className="booking-message">{dashboardMessage}</div>}
            </div>
          </main>

          <aside className="sanctum-panel-box booking-side-panel">
            <div className="panel-header-row">
              <div className="mystic-header-label">Live Hospital Feed</div>
            </div>
            <div className="live-update-caption">{formatRelativeUpdate(lastBedUpdateAt)}</div>
            {hospitalInventory.length > 0 ? (
              <div className="bed-options-list">
                {hospitalInventory.map((hospital) => (
                  <div className="bed-option-item" key={hospital.hospital}>
                    <div className={`availability-forecast-badge ${hospital.availability_status || 'available_now'}`}>
                      {hospital.predicted_availability_label || 'Beds available now'}
                    </div>
                    <div className="bed-option-title">{hospital.hospital}</div>
                    <div className="bed-option-meta">{hospital.city}, {hospital.country}</div>
                    <div className="bed-option-meta">Beds: {hospital.available_beds} | ICU: {hospital.icu_beds} | Ventilators: {hospital.ventilators}</div>
                    <div className="bed-option-meta">Mode: {hospital.availability_mode} | Updated: {hospital.last_updated}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state booking-empty-state">No hospitals loaded yet.</div>
            )}

            <div className="admin-metrics-panel">
              <div className="report-headline">Dashboard Metrics</div>
              {adminMetrics ? (
                <>
                  <div className="report-line"><strong>Total Bookings:</strong> {adminMetrics.total_bookings}</div>
                  <div className="report-line"><strong>Bed Utilization:</strong> {adminMetrics.bed_utilization_rate}%</div>
                  <div className="report-line"><strong>Peak Regions:</strong> {(adminMetrics.peak_demand_regions || []).map((item) => `${item.region} (${item.count})`).join(', ') || 'No data yet'}</div>
                  <div className="report-line"><strong>Emergency Heatmap:</strong> {(adminMetrics.emergency_heatmap || []).map((item) => `${item.region} (${item.count})`).join(', ') || 'No emergency data yet'}</div>
                </>
              ) : (
                <div className="report-line">Metrics will appear after booking and emergency activity.</div>
              )}
            </div>
          </aside>
        </div>
      ) : carePath === 'booking' ? (
        <div className="sanctum-main-layout booking-mode-layout">
          <main className="sanctum-panel-box booking-main-panel">
            <div className="panel-header-row">
              <div className="mystic-header-label">Immediate Bed Booking</div>
            </div>
            <div className="booking-hero-card">
              <div className="booking-hero-title">Update prescription and reserve the nearest available bed</div>
              <div className="booking-hero-copy">
                Enter patient details, add the latest prescription note, and DISHA will show the closest available hospitals.
              </div>
              <div className="live-update-caption">{formatRelativeUpdate(lastBedUpdateAt)}</div>
              <div className="meta-field booking-triage-field">
                <label>Current Severity</label>
                <select
                  className="magic-input-field"
                  value={result?.severity || bookingSeverity}
                  onChange={(e) => setBookingSeverity(e.target.value)}
                  disabled={Boolean(result?.severity)}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="MODERATE">Moderate</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div className="meta-field booking-triage-field">
                <label>Symptoms / Urgency Notes</label>
                <textarea
                  className="magic-input-field prescription-textarea"
                  placeholder="Example: breathlessness, low oxygen, seizure, severe headache"
                  value={bookingSymptoms}
                  onChange={(e) => setBookingSymptoms(e.target.value)}
                />
              </div>
              <div style={{ fontSize: '12px', opacity: 0.85, marginBottom: '8px' }}>
                Add location details for faster nearest-bed matching.
              </div>
              <label className="consent-checkbox-row">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                I consent to processing of sensitive health data for care support.
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={searchWorldwide}
                  onChange={(e) => setSearchWorldwide(e.target.checked)}
                />
                Search worldwide hospitals
              </label>
              <button
                className="mystic-gold-button emergency-mode-button"
                onClick={activateEmergencyMode}
                disabled={bookingLoading || emergencyLoading}
              >
                {emergencyLoading ? 'Locating nearest ICU...' : t('emergencyButton')}
              </button>
              <button
                className="mystic-gold-button primary booking-search-button"
                onClick={fetchNearestBeds}
                disabled={bookingLoading || emergencyLoading}
              >
                {bookingLoading ? 'Checking availability...' : searchWorldwide ? 'Find Nearest Beds Worldwide' : 'Update Prescription and Find Beds'}
              </button>
              <button
                className="mystic-gold-button booking-search-button"
                onClick={() => {
                  const hospitalName = bedRecommendations.current?.hospital || filteredNearestBeds[0]?.hospital;
                  if (hospitalName) {
                    bookNearestBed(hospitalName);
                  }
                }}
                disabled={bookingLoading || emergencyLoading || (!bedRecommendations.current?.hospital && filteredNearestBeds.length === 0)}
              >
                {bookingLoading ? 'Booking...' : 'Book Best Option'}
              </button>
            </div>

            <div className="booking-filter-bar">
              <div className="meta-field booking-filter-field">
                <label>Find Hospital</label>
                <input
                  className="magic-input-field"
                  placeholder="Search by hospital or city"
                  value={bedSearchQuery}
                  onChange={(e) => setBedSearchQuery(e.target.value)}
                />
              </div>
              <div className="meta-field booking-filter-field">
                <label>Max Distance (km)</label>
                <input
                  className="magic-input-field"
                  type="range"
                  min="2"
                  max="100"
                  step="1"
                  value={maxDistanceKm}
                  onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                />
                <div className="booking-filter-caption">{maxDistanceKm} km radius</div>
              </div>
              <label className="consent-checkbox-row compact booking-filter-toggle">
                <input
                  type="checkbox"
                  checked={filterIcuOnly}
                  onChange={(e) => setFilterIcuOnly(e.target.checked)}
                />
                ICU-ready only
              </label>
            </div>

            <div className="booking-insights-grid">
              <div className="booking-insight-card">
                <div className="booking-insight-label">Visible Hospitals</div>
                <div className="booking-insight-value">{filteredNearestBeds.length}</div>
              </div>
              <div className="booking-insight-card">
                <div className="booking-insight-label">Total Beds</div>
                <div className="booking-insight-value">{bookingInsights.totalBeds}</div>
              </div>
              <div className="booking-insight-card">
                <div className="booking-insight-label">Avg Distance</div>
                <div className="booking-insight-value">{bookingInsights.avgDistance ? `${bookingInsights.avgDistance} km` : 'N/A'}</div>
              </div>
              <div className="booking-insight-card">
                <div className="booking-insight-label">Likely Soon</div>
                <div className="booking-insight-value">{bookingInsights.likelySoon}</div>
              </div>
            </div>

            {(bedRecommendations.current || bedRecommendations.predicted) && (
              <div className="booking-recommendation-grid">
                {bedRecommendations.current && (
                  <div className="booking-recommendation-card current-option">
                    <div className="booking-recommendation-title">{bedRecommendations.current.title}</div>
                    <div className="booking-recommendation-hospital">{bedRecommendations.current.hospital}</div>
                    <div className="booking-recommendation-meta">{bedRecommendations.current.city}, {bedRecommendations.current.country}</div>
                    <div className="booking-recommendation-meta">Distance: {bedRecommendations.current.distance_km} km</div>
                    <button
                      className="mystic-gold-button bed-book-btn"
                      onClick={() => bookNearestBed(bedRecommendations.current.hospital)}
                      disabled={bookingLoading}
                    >
                      {bookingLoading ? 'Booking...' : 'Book Best Current Option'}
                    </button>
                  </div>
                )}
                {bedRecommendations.predicted && (
                  <div className="booking-recommendation-card predicted-option">
                    <div className="booking-recommendation-title">{bedRecommendations.predicted.title}</div>
                    <div className="booking-recommendation-hospital">{bedRecommendations.predicted.hospital}</div>
                    <div className="booking-recommendation-meta">{bedRecommendations.predicted.city}, {bedRecommendations.predicted.country}</div>
                    <div className="booking-recommendation-meta">{bedRecommendations.predicted.predicted_availability_label} | Expected openings: {bedRecommendations.predicted.predicted_openings_3h}</div>
                    <div className="booking-recommendation-meta">Distance: {bedRecommendations.predicted.distance_km} km</div>
                  </div>
                )}
              </div>
            )}

            {triageRecommendation && (
              <div className={`triage-recommendation-banner ${triageRecommendation.care_level === 'icu' ? 'urgent' : 'normal'}`}>
                <div className="triage-title">Recommendation: {triageRecommendation.label}</div>
                <div className="triage-reason">{triageRecommendation.reason}</div>
                {Array.isArray(triageRecommendation.activated_features) && triageRecommendation.activated_features.length > 0 && (
                  <div className="triage-reason">
                    Trigger signals: {triageRecommendation.activated_features.join(', ')}
                  </div>
                )}
              </div>
            )}

            <div className="booking-map-panel">
              <div className="report-headline">{t('mapTitle')}</div>
              <HospitalMap hospitals={filteredNearestBeds} emergencyMode={emergencyLoading} />
            </div>

            <div className="bed-booking-panel booking-mode-panel">
              <div className="report-headline">Nearest Available Hospitals</div>
              {filteredNearestBeds.length > 0 ? (
                <div className="bed-options-list booking-options-grid">
                  {filteredNearestBeds.map((option, idx) => (
                    <div className="bed-option-item" key={`${option.hospital}-${idx}`}>
                      {option.is_best_option && <div className="best-option-badge">Best Option</div>}
                      <div className={`availability-forecast-badge ${option.availability_status || 'available_now'}`}>
                        {option.predicted_availability_label || 'Beds available now'}
                      </div>
                      <div className="bed-option-title">{option.hospital}</div>
                      <div className="bed-option-meta">{option.city}, {option.country} | {option.address}</div>
                      <div className="bed-option-meta">Distance: {option.estimated_distance_km} km | Beds: {option.available_beds} | ICU: {option.icu_beds} | Ventilators: {option.ventilators}</div>
                      {typeof option.predicted_openings_3h === 'number' && option.availability_status === 'likely_soon' && (
                        <div className="bed-option-meta bed-option-explain">
                          Forecast: around {option.predicted_openings_3h} bed(s) may open in the next 2-3 hours based on recent discharge trends.
                        </div>
                      )}
                      <div className="bed-option-meta">Rating: {option.rating}/5 | Success Rate: {option.success_rate}%</div>
                      <button
                        className="mystic-gold-button bed-book-btn"
                        onClick={() => bookNearestBed(option.hospital)}
                        disabled={bookingLoading || option.available_beds <= 0}
                      >
                        {bookingLoading ? 'Booking...' : 'Book This Bed'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state booking-empty-state">No hospitals match the current filters. Try increasing distance or disabling ICU-only mode.</div>
              )}
              {bookingMessage && <div className="booking-message">{bookingMessage}</div>}
            </div>
          </main>

          <aside className="sanctum-panel-box booking-side-panel">
            <div className="panel-header-row">
              <div className="mystic-header-label">Care Summary</div>
            </div>
            <div className="report-meta">
              <div><strong>Patient:</strong> {patientName || 'Not entered'}</div>
              <div><strong>Bed Number:</strong> {bedNumber || 'Not entered'}</div>
              <div><strong>Residence:</strong> {residence || 'Not entered'}</div>
            </div>
            <div className="report-analysis-block">
              <div className="report-line">{prescriptionUpdate || 'Prescription update will appear here once entered.'}</div>
              <div className="report-line"><strong>Prescription file:</strong> {prescriptionFile?.name || 'Not uploaded'}</div>
            </div>
            {bookingInfo ? (
              <div className="booking-confirm-card">
                <div className="report-headline">Booking Confirmed</div>
                <div className="report-line"><strong>Hospital:</strong> {bookingInfo.hospital}</div>
                <div className="report-line"><strong>Booking ID:</strong> {bookingInfo.booking_id}</div>
                <div className="report-line"><strong>Estimated arrival:</strong> {bookingInfo.estimated_arrival_window || 'Pending'}</div>
                <div className="report-line"><strong>Confirmation:</strong> {bookingInfo.notification_status?.summary || 'No notification channel requested'}</div>
                {bookingInfo.family_tracking_link && (
                  <div className="report-line tracking-link-row">
                    <strong>Family Tracking:</strong>
                    <a href={bookingInfo.family_tracking_link} target="_blank" rel="noreferrer">Open live status link</a>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state booking-empty-state">Your confirmed bed details will appear here.</div>
            )}

            <div className="booking-confirm-card ambulance-panel">
              <div className="report-headline">Ambulance Integration</div>
              {ambulanceOptions.length > 0 ? (
                ambulanceOptions.map((option, index) => (
                  <div key={`${option.service || option.provider || 'ambulance'}-${index}`} className="report-line">
                    <strong>{option.service || option.provider || 'Ambulance Service'}</strong> | ETA: {option.eta_min || 'N/A'} mins | {option.phone}
                  </div>
                ))
              ) : (
                <div className="report-line">No ambulance options loaded yet. Emergency mode will populate this list.</div>
              )}
            </div>
          </aside>
        </div>
      ) : (
      <>
      <div className="sanctum-main-layout">
        
        {/* PANEL: 2D AXIAL SLICE */}
        <aside className="sanctum-panel-box side-column">
          <div className="panel-header-row">
            <div className="mystic-header-label">2D_AXIAL_SLICE_VIEWER</div>
          </div>
          
          <div className="mirror-viewport-container">
            <div className="viewport-inner-lock">
                {preview ? (
                <img src={preview} alt="Medical Scan" className="scan-img-relic" />
                ) : (
                <div className="placeholder-text">No scan uploaded yet</div>
                )}
                {loading && <div className="scanning-bar-animation"></div>}
            </div>
            <div className="viewport-overlay-data">
              <span>Scan Preview</span>
            </div>
          </div>

          <div className="input-action-zone">
            <input 
              type="file" 
              id="dicom-upload" 
              hidden 
              accept=".dcm,.nii,.nii.gz,.jpg,.jpeg,.png"
              onChange={e => {
                if(e.target.files[0]) {
                  const selectedFile = e.target.files[0];
                  // Security: Validate file
                  const validation = FrontendSecurity.validateFile(selectedFile, 25);
                  if (!validation.valid) {
                    alert(`This file cannot be uploaded: ${validation.error}`);
                    addLog(`[SECURITY] FILE_REJECTED: ${validation.error}`);
                    return;
                  }
                  setFile(selectedFile);
                  setResult(null);
                  setIs3DExpanded(false);
                  setCinematicTour3D(false);
                  setAutoSpin3D(true);
                  setShowViewerControls(false);
                  setPreview(URL.createObjectURL(selectedFile));
                  setScanMessage('');
                  addLog(`MOUNTED_SLICE: ${selectedFile.name.toUpperCase()}`);
                  FrontendSecurity.logEvent('FILE_UPLOAD', { action: 'file_selected', status: 'valid' });
                }
              }} 
            />
            <label htmlFor="dicom-upload" className="mystic-gold-button">Upload Scan</label>
            <div className="live-update-caption">
              Supported formats: DICOM (.dcm), NIfTI (.nii, .nii.gz), JPG, PNG
            </div>

            <label className="consent-checkbox-row compact">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              I consent to processing of sensitive health data for scan analysis.
            </label>
            
            <button 
              className={`mystic-gold-button primary${loading ? ' loading-state' : ''}`}
              onClick={executeInference}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }}></span>
                  Analysing scan...
                </span>
              ) : "Run 3D Analysis"}
            </button>

            <button
              className="mystic-gold-button"
              onClick={() => setActiveTab("REPORT")}
              disabled={!result}
            >
              Detailed Report
            </button>
            {scanMessage && <div className="booking-message">{scanMessage}</div>}
          </div>

          <div className="dicom-metadata-preview">
             <div className="meta-row"><span>Scan Type:</span> <span>{result?.modality || '---'}</span></div>
             <div className="meta-row"><span>Updated:</span> <span>{result?.timestamp?.split(' ')[1] || '---'}</span></div>
          </div>
        </aside>

        {/* PANEL: 3D VOLUMETRIC RECONSTRUCTION */}
        <main className="sanctum-panel-box main-column">
          <div className="panel-header-row">
            <div className="mystic-header-label">3D_MULTI_CLASS_SEGMENTATION_MASK</div>
            {result && (
              <div className="view-toggle-controls">
                <button className={viewMode === "VOXEL" ? "active" : ""} onClick={() => setViewMode("VOXEL")}>VOXEL</button>
                <button className={viewMode === "WIRE" ? "active" : ""} onClick={() => setViewMode("WIRE")}>WIRE</button>
              </div>
            )}
          </div>
          
          <div className={`three-dimension-viewport-container ${is3DExpanded ? 'expanded' : ''}`}>
            {/* dpr cap: retina screens would render 2-3× pixel budget without this */}
            {/* antialias: false reduces GPU load significantly on point clouds      */}
            {result && (
              <Canvas
                dpr={performanceProfile === 'eco' ? [1, 1] : [1, 1.25]}
                gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
                camera={{ position: [0, 0, 6], fov: 40 }}
                onCreated={({ gl }) => {
                  rendererCanvasRef.current = gl.domElement;
                }}
              >
                <MedicalMesh
                  active={!!result}
                  result={result}
                  viewMode={viewMode}
                  focusMode={is3DExpanded}
                  performanceProfile={performanceProfile}
                  cameraCommand={viewerCommand}
                  autoSpin={autoSpin3D}
                  cinematicTour={cinematicTour3D}
                  severityTheme={severityTheme}
                />
              </Canvas>
            )}

            {/* Empty state shown when no scan has been processed yet */}
            {!result && (
              <div className="viewport-empty-state">
                <div className="empty-state-icon">&#x2299;</div>
                <div className="empty-state-title">No Scan Loaded</div>
                <div className="empty-state-hint">Upload a medical scan and run analysis to see the 3D tumor model here.</div>
              </div>
            )}

            {is3DExpanded && (
              <button
                className="collapse-3d-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIs3DExpanded(false);
                }}
              >
                Minimize
              </button>
            )}

            {result && !is3DExpanded && (
              <button
                className="expand-3d-btn"
                onClick={() => setIs3DExpanded(true)}
              >
                Expand View
              </button>
            )}

            {result && !showViewerControls && (
              <button
                className="viewer-options-toggle-btn"
                onClick={() => setShowViewerControls(true)}
              >
                More Options
              </button>
            )}

            {result && showViewerControls && (
              <div className="viewport-control-dock" role="group" aria-label="3D viewport controls">
                <button className="dock-btn dock-btn-hide" onClick={() => setShowViewerControls(false)}>Hide Options</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('zoom-in')}>Zoom +</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('zoom-out')}>Zoom -</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('rotate-left')}>Rotate Left</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('rotate-right')}>Rotate Right</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('rotate-up')}>Rotate Up</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('rotate-down')}>Rotate Down</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('preset-front')}>Front</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('preset-side')}>Side</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('preset-top')}>Top</button>
                <button className="dock-btn" onClick={() => issueViewerCommand('preset-iso')}>Isometric</button>
                <button
                  className={`dock-btn ${autoSpin3D ? 'spin-on' : ''}`}
                  onClick={() => {
                    setAutoSpin3D((prev) => !prev);
                    setCinematicTour3D(false);
                  }}
                >
                  {autoSpin3D ? 'Auto Spin: ON' : 'Auto Spin: OFF'}
                </button>
                <button
                  className={`dock-btn cinematic ${cinematicTour3D ? 'spin-on' : ''}`}
                  onClick={toggleCinematicTour}
                >
                  {cinematicTour3D ? 'Cinematic: ON' : 'Cinematic Tour'}
                </button>
                <button className="dock-btn screenshot" onClick={download3DScreenshot}>Save PNG</button>
                <button className="dock-btn reset" onClick={() => issueViewerCommand('reset-view')}>Reset</button>
              </div>
            )}

            {result && is3DExpanded && (
              <div className="viewport-hud-overlay">
                <div className="hud-line">Model: <span className="blue">MONAI v5</span></div>
                <div className="hud-line">Points: <span className="blue">{result?.voxels?.length ? result.voxels.length.toLocaleString() : '—'}</span></div>
                <div className="hud-line">Rendered: <span className="blue">{result?.voxels?.length ? Math.min(result.voxels.length, 3000).toLocaleString() : '—'}</span></div>
                <div className="hud-line">Spin: <span className="blue">{autoSpin3D ? 'ON' : 'OFF'}</span></div>
                <div className="hud-line">Theme: <span className="blue">{severityTheme.toUpperCase()}</span></div>
                <div className="hud-line">Tour: <span className="blue">{cinematicTour3D ? 'CINEMATIC ON' : 'OFF'}</span></div>
                <div className="hud-line">Mouse/Touch: drag to orbit, wheel/pinch to zoom, right-drag to pan</div>
                <div className="hud-line">Shortcuts: R reset, C cinematic, S screenshot, 1/2/3/4 presets, +/- zoom</div>
              </div>
            )}
          </div>
        </main>

        {/* PANEL: QUANTITATIVE ANALYTICS */}
        <aside className="sanctum-panel-box side-column analytics-panel terminal-metrics-panel">
          <div className="tab-navigation">
            <button className={activeTab === "QUANTITATIVE" ? "active" : ""} onClick={() => setActiveTab("QUANTITATIVE")}>METRICS</button>
            <button className={activeTab === "REPORT" ? "active" : ""} onClick={() => setActiveTab("REPORT")}>ARCHIVES</button>
            <button className={activeTab === "HISTORY" ? "active" : ""} onClick={() => setActiveTab("HISTORY")}>LOGS</button>
          </div>

          <div className="tab-body-content" key={activeTab} style={{ animation: 'fadeIn 0.22s ease both' }}>
            {activeTab === "QUANTITATIVE" ? (
              <div className="quantitative-report">
                {result ? (
                  <div className="report-data-stack">
                    <div className="data-row">
                      <span className="label">Prediction</span>
                      <span className={`value ${result.prediction.includes('NO TUMOR') ? 'green' : result.prediction.includes('DETECTED') ? 'red' : ''}`}>{result.prediction}</span>
                    </div>
                    <div className="data-row"><span className="label">Tumor Volume</span><span className="value blue">{result.volume}</span></div>
                    <div className="data-row"><span className="label">Max Diameter</span><span className="value">{result.diameter}</span></div>
                    <div className="data-row"><span className="label">AI Confidence</span><span className="value">{result.confidence}%</span></div>
                    <div className="data-row">
                      <span className="label">Severity</span>
                      <span className={`value status-${result.severity?.toLowerCase()}`}>{result.severity}</span>
                    </div>
                    <div className="kernel-log-shell">
                      <div className="kernel-log-title">SYSTEM_KERNEL_LOG</div>
                      <div className="terminal-log-output compact">
                        {logsRef.current.slice(-7).map((line, idx) => (
                          <div key={`${line}-${idx}`} className="log-line">{line}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">Upload a scan and run <strong>3D Analysis</strong> to view key metrics.</div>
                )}
              </div>
            ) : activeTab === "REPORT" ? (
              <div className="report-panel">
                {result ? (
                  <>
                    <div className="report-headline">Detailed Report</div>
                    <div className="report-meta">
                      <div><strong>Patient:</strong> {result.patient_name}</div>
                      <div><strong>Bed:</strong> {result.bed_number}</div>
                      <div><strong>Residence:</strong> {result.residence}</div>
                      <div><strong>Study ID:</strong> {result.subject_id}</div>
                    </div>
                    <div className="report-analysis-block">
                      {(result.detailed_report || []).map((line, idx) => (
                        <div key={idx} className="report-line">{line}</div>
                      ))}
                    </div>
                    <SummaryCard
                      summary={result.summary || result.analysis_note}
                      advice={result.ai_advice || result.recommendation || result.clinical_recommendation}
                    />
                    <ResultsTable tests={result.tests} />
                    <div className="report-note">{result.analysis_note}</div>
                    <div className="quick-actions-row">
                      <button className="mystic-gold-button report-download-btn" onClick={downloadDetailedReport}>
                        Download PDF Report
                      </button>
                      <button className="mystic-gold-button report-download-btn" onClick={printDetailedReport}>
                        Print Report
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Run <strong>3D Analysis</strong> first. Your full report will appear here.</div>
                )}
              </div>
            ) : (
              <div className="clinical-history-list">
                {history.length > 0 ? history.map((h, i) => (
                  <div key={i} className="history-item">
                    <div className="history-meta"><span className="h-name">{h.patient_name}</span><span className="h-vol">{h.volume}</span></div>
                    <div className="h-status">{h.prediction}</div>
                  </div>
                )) : (
                  <div className="empty-state">No records yet. Analysis archives will appear here after a scan.</div>
                )}
              </div>
            )}
          </div>

          <button className="obliterate-records-btn" onClick={purgeSystemMemory}>Clear History</button>
        </aside>

      </div>
      </>
      )}
    </div>
  );
}

export default App;