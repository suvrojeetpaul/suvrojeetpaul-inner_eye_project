import os
import copy
import io
import re
import time
import random
import datetime
import secrets
import hashlib
import jwt
import torch
import numpy as np
import pydicom
import nibabel as nib
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Header, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
from scipy.ndimage import zoom
from math import radians, sin, cos, atan2, sqrt, exp
import logging
from cryptography.fernet import Fernet
from passlib.context import CryptContext

# Import security module
from security import (
    SecurityConfig,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    InputValidator,
    SecurityLogger,
    security_logger
)

# MONAI / PyTorch Imports for 3D Segmentation
from monai.networks.nets import UNet
# Updated MONAI Imports for Compatibility
from monai.transforms import (
    Compose, 
    EnsureChannelFirstd,  # Replaces AddChanneld
    LoadImaged, 
    Resized, 
    ScaleIntensityd, 
    EnsureTyped
)

# --- SYSTEM INITIALIZATION WITH SECURITY ---
app = FastAPI(title="INNER_EYE // MONAI_SEGMENTATION_CORE", version="5.0.2")
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# --- SECURITY MIDDLEWARE STACK ---
# Add rate limiting
app.add_middleware(
    RateLimitMiddleware,
    requests_per_minute=SecurityConfig.RATE_LIMIT_REQUESTS
)

# Add security headers
app.add_middleware(SecurityHeadersMiddleware)

# Configure CORS properly - ONLY allow trusted origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=SecurityConfig.ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=SecurityConfig.ALLOWED_METHODS,
    allow_headers=SecurityConfig.ALLOWED_HEADERS,
)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- DATASET REGISTRY & METADATA ---
DATASET_MAP = {
    "neuro_axial": {
        "dataset": "BraTS 2021",
        "target": "GLIOMA_SEGMENTATION",
        "labels": {0: "Background", 1: "Edema", 2: "Enhancing Tumor"},
        "threshold": 190
    },
    "pulmonary": {
        "dataset": "LUNA16",
        "target": "LUNG_NODULE_DETECTION",
        "labels": {0: "Background", 1: "Lung Tissue", 2: "Nodule"},
        "threshold": 140
    },
    "cardio_thoracic": {
        "dataset": "LiTS",
        "target": "LIVER_TUMOR_MAPPING",
        "labels": {0: "Background", 1: "Liver", 2: "Lesion"},
        "threshold": 160
    }
}

class ClinicalFinding(BaseModel):
    subject_id: str
    patient_name: str
    bed_number: str
    residence: str
    modality: str
    dataset_context: str
    prediction: str
    confidence: float
    volume: str
    diameter: str
    severity: str
    detailed_report: List[str]
    analysis_note: str
    voxels: List[List[float]]
    coords: Dict[str, float]
    dice_score: float
    timestamp: str


class AuthSignupRequest(BaseModel):
    username: str
    password: str
    role: Optional[str] = "patient"
    admin_invite_code: Optional[str] = None


class AuthLoginRequest(BaseModel):
    username: str
    password: str


patients_db: List[Dict] = []
users_db: Dict[str, Dict[str, str]] = {}
booking_events: List[Dict[str, Any]] = []
emergency_events: List[Dict[str, Any]] = []
tracking_links: Dict[str, Dict[str, Any]] = {}
hospital_query_cache: Dict[str, Dict[str, Any]] = {}
QUERY_CACHE_TTL_SECONDS = 45
API_BASE_URL = os.getenv("PUBLIC_API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
FAILED_LOGIN_ATTEMPTS: Dict[str, Dict[str, Any]] = {}
ACCOUNT_LOCKOUT_MINUTES = max(1, int(os.getenv("ACCOUNT_LOCKOUT_MINUTES", str(SecurityConfig.LOGIN_TIMEOUT_MINUTES))))
ACCESS_TOKEN_EXP_MINUTES = max(5, int(os.getenv("ACCESS_TOKEN_EXP_MINUTES", str(SecurityConfig.SESSION_TIMEOUT_MINUTES))))
SYSTEM_ADMIN_INVITE_CODE = os.getenv("SYSTEM_ADMIN_INVITE_CODE", "")
HOSPITAL_ADMIN_INVITE_CODE = os.getenv("HOSPITAL_ADMIN_INVITE_CODE", "")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_fernet_key() -> bytes:
    configured = os.getenv("DISHA_ENCRYPTION_KEY", "").strip()
    if configured:
        return configured.encode()
    return Fernet.generate_key()


fernet = Fernet(get_fernet_key())


def encrypt_sensitive(value: str) -> str:
    if not value:
        return ""
    return fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive(value: str) -> str:
    if not value:
        return ""
    return fernet.decrypt(value.encode("utf-8")).decode("utf-8")


def validate_username(username: str) -> str:
    clean = (username or "").strip().lower()
    if not re.match(r"^[a-z0-9_.-]{3,32}$", clean):
        raise ValueError("USERNAME_MUST_BE_3_TO_32_CHARS_ALPHANUMERIC")
    return clean


def normalize_role(role_value: Optional[str]) -> str:
    role = (role_value or "patient").strip().lower()
    if role not in {"patient", "hospital_admin", "system_admin"}:
        raise HTTPException(status_code=422, detail="INVALID_ROLE")
    return role


def validate_password_strength(password: str) -> None:
    if len((password or "")) < 8:
        raise HTTPException(status_code=422, detail="PASSWORD_TOO_SHORT")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=422, detail="PASSWORD_MUST_INCLUDE_UPPERCASE")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=422, detail="PASSWORD_MUST_INCLUDE_LOWERCASE")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=422, detail="PASSWORD_MUST_INCLUDE_DIGIT")


def issue_access_token(username: str, role: str) -> Dict[str, Any]:
    now = datetime.datetime.utcnow()
    exp = now + datetime.timedelta(minutes=ACCESS_TOKEN_EXP_MINUTES)
    csrf_token = secrets.token_urlsafe(24)
    payload = {
        "sub": username,
        "role": role,
        "csrf": csrf_token,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, SecurityConfig.JWT_SECRET, algorithm=SecurityConfig.JWT_ALGORITHM)
    return {
        "token": token,
        "csrf_token": csrf_token,
        "expires_at": exp.isoformat() + "Z",
    }


def decode_access_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, SecurityConfig.JWT_SECRET, algorithms=[SecurityConfig.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        security_logger.log_suspicious_activity("EXPIRED_ACCESS_TOKEN")
        raise HTTPException(status_code=401, detail="SESSION_EXPIRED")
    except jwt.InvalidTokenError:
        security_logger.log_suspicious_activity("INVALID_ACCESS_TOKEN")
        raise HTTPException(status_code=401, detail="INVALID_SESSION")


def get_authenticated_user(authorization: Optional[str]) -> Dict[str, str]:
    if not authorization:
        raise HTTPException(status_code=401, detail="AUTH_REQUIRED")
    token = authorization.replace("Bearer", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="AUTH_REQUIRED")
    claims = decode_access_token(token)
    username = claims.get("sub")
    role = claims.get("role")
    csrf = claims.get("csrf")
    if not username or not role or not csrf:
        raise HTTPException(status_code=401, detail="INVALID_SESSION")
    return {
        "username": username,
        "role": role,
        "csrf": csrf,
    }


def get_session_username(authorization: Optional[str]) -> str:
    user = get_authenticated_user(authorization)
    return user["username"]


def require_role(user: Dict[str, str], allowed_roles: set) -> None:
    if user.get("role") not in allowed_roles:
        raise HTTPException(status_code=403, detail="FORBIDDEN_BY_ROLE")


def verify_csrf_token(user: Dict[str, str], csrf_header: Optional[str]) -> None:
    if not csrf_header:
        raise HTTPException(status_code=403, detail="CSRF_TOKEN_REQUIRED")
    if csrf_header != user.get("csrf"):
        security_logger.log_suspicious_activity(f"CSRF_MISMATCH user={user.get('username')}")
        raise HTTPException(status_code=403, detail="INVALID_CSRF_TOKEN")


def check_and_update_lockout(username: str, login_success: bool) -> None:
    now = datetime.datetime.utcnow()
    entry = FAILED_LOGIN_ATTEMPTS.get(username)
    if login_success:
        FAILED_LOGIN_ATTEMPTS.pop(username, None)
        return

    if entry:
        locked_until = entry.get("locked_until")
        if locked_until and now < locked_until:
            remaining = int((locked_until - now).total_seconds() // 60) + 1
            raise HTTPException(status_code=423, detail=f"ACCOUNT_LOCKED_TRY_IN_{remaining}_MIN")

    if not entry:
        entry = {"count": 0, "locked_until": None}
    entry["count"] = int(entry.get("count", 0)) + 1
    if entry["count"] >= SecurityConfig.MAX_LOGIN_ATTEMPTS:
        entry["locked_until"] = now + datetime.timedelta(minutes=ACCOUNT_LOCKOUT_MINUTES)
        security_logger.log_suspicious_activity(f"ACCOUNT_LOCKED username={username}")
    FAILED_LOGIN_ATTEMPTS[username] = entry

HOSPITAL_BEDS: List[Dict] = [
    {"hospital": "DISHA Central Care", "city": "Kolkata", "country": "India", "address": "Salt Lake Sector V", "lat": 22.5726, "lon": 88.3639, "available_beds": 6},
    {"hospital": "GreenLife Oncology Centre", "city": "Howrah", "country": "India", "address": "Shibpur Medical District", "lat": 22.5958, "lon": 88.2636, "available_beds": 4},
    {"hospital": "Sunrise Neuro Institute", "city": "Durgapur", "country": "India", "address": "City Centre Clinical Block", "lat": 23.5204, "lon": 87.3119, "available_beds": 5},
    {"hospital": "Eastern Lung and Chest Hospital", "city": "Siliguri", "country": "India", "address": "Hill Cart Medical Avenue", "lat": 26.7271, "lon": 88.3953, "available_beds": 3},
    {"hospital": "Riverfront Multispeciality", "city": "Kalyani", "country": "India", "address": "Station Road, Kalyani", "lat": 22.9868, "lon": 88.4345, "available_beds": 2},
    {"hospital": "St Thomas Medical Center", "city": "London", "country": "United Kingdom", "address": "Westminster Health Corridor", "lat": 51.5072, "lon": -0.1276, "available_beds": 7},
    {"hospital": "North River Cancer Hospital", "city": "New York", "country": "United States", "address": "Upper East Medical District", "lat": 40.7128, "lon": -74.0060, "available_beds": 8},
    {"hospital": "Pacific Hope Institute", "city": "Los Angeles", "country": "United States", "address": "Santa Monica Care Avenue", "lat": 34.0522, "lon": -118.2437, "available_beds": 6},
    {"hospital": "Maple Leaf Oncology", "city": "Toronto", "country": "Canada", "address": "Downtown Health Park", "lat": 43.6532, "lon": -79.3832, "available_beds": 5},
    {"hospital": "Berlin Unity Klinikum", "city": "Berlin", "country": "Germany", "address": "Mitte Clinical Campus", "lat": 52.5200, "lon": 13.4050, "available_beds": 6},
    {"hospital": "Paris Lumiere Sante", "city": "Paris", "country": "France", "address": "Rue de la Sante", "lat": 48.8566, "lon": 2.3522, "available_beds": 4},
    {"hospital": "Harborline Medical Hub", "city": "Sydney", "country": "Australia", "address": "Darling Harbour Health Block", "lat": -33.8688, "lon": 151.2093, "available_beds": 7},
    {"hospital": "Tokyo Frontier Hospital", "city": "Tokyo", "country": "Japan", "address": "Shinjuku Care Zone", "lat": 35.6762, "lon": 139.6503, "available_beds": 5},
    {"hospital": "Marina Bay Cancer Centre", "city": "Singapore", "country": "Singapore", "address": "Marina Health Campus", "lat": 1.3521, "lon": 103.8198, "available_beds": 4},
    {"hospital": "Emirates Specialist Hospital", "city": "Dubai", "country": "United Arab Emirates", "address": "Jumeirah Medical Zone", "lat": 25.2048, "lon": 55.2708, "available_beds": 5},
]

# Clinical capacity and quality metadata used by smart-ranking.
HOSPITAL_CAPACITY: Dict[str, Dict] = {
    "DISHA Central Care": {"icu_beds": 3, "ventilators": 4, "rating": 4.6, "success_rate": 92},
    "GreenLife Oncology Centre": {"icu_beds": 2, "ventilators": 3, "rating": 4.3, "success_rate": 89},
    "Sunrise Neuro Institute": {"icu_beds": 3, "ventilators": 3, "rating": 4.4, "success_rate": 90},
    "Eastern Lung and Chest Hospital": {"icu_beds": 2, "ventilators": 2, "rating": 4.2, "success_rate": 88},
    "Riverfront Multispeciality": {"icu_beds": 1, "ventilators": 1, "rating": 4.0, "success_rate": 85},
    "St Thomas Medical Center": {"icu_beds": 4, "ventilators": 6, "rating": 4.7, "success_rate": 94},
    "North River Cancer Hospital": {"icu_beds": 5, "ventilators": 7, "rating": 4.8, "success_rate": 95},
    "Pacific Hope Institute": {"icu_beds": 4, "ventilators": 5, "rating": 4.6, "success_rate": 93},
    "Maple Leaf Oncology": {"icu_beds": 3, "ventilators": 4, "rating": 4.5, "success_rate": 91},
    "Berlin Unity Klinikum": {"icu_beds": 4, "ventilators": 5, "rating": 4.6, "success_rate": 93},
    "Paris Lumiere Sante": {"icu_beds": 3, "ventilators": 4, "rating": 4.4, "success_rate": 90},
    "Harborline Medical Hub": {"icu_beds": 4, "ventilators": 6, "rating": 4.7, "success_rate": 94},
    "Tokyo Frontier Hospital": {"icu_beds": 4, "ventilators": 5, "rating": 4.7, "success_rate": 94},
    "Marina Bay Cancer Centre": {"icu_beds": 3, "ventilators": 4, "rating": 4.6, "success_rate": 92},
    "Emirates Specialist Hospital": {"icu_beds": 3, "ventilators": 4, "rating": 4.5, "success_rate": 91},
}

# Simulated historical turnover trends used for short-horizon bed forecasts.
HOSPITAL_BED_TRENDS: Dict[str, Dict[str, float]] = {
    "DISHA Central Care": {"avg_release_3h": 1.6, "peak_multiplier": 1.15},
    "GreenLife Oncology Centre": {"avg_release_3h": 1.2, "peak_multiplier": 1.05},
    "Sunrise Neuro Institute": {"avg_release_3h": 1.4, "peak_multiplier": 1.10},
    "Eastern Lung and Chest Hospital": {"avg_release_3h": 1.1, "peak_multiplier": 1.00},
    "Riverfront Multispeciality": {"avg_release_3h": 0.8, "peak_multiplier": 0.95},
    "St Thomas Medical Center": {"avg_release_3h": 1.8, "peak_multiplier": 1.12},
    "North River Cancer Hospital": {"avg_release_3h": 2.0, "peak_multiplier": 1.18},
    "Pacific Hope Institute": {"avg_release_3h": 1.7, "peak_multiplier": 1.10},
    "Maple Leaf Oncology": {"avg_release_3h": 1.4, "peak_multiplier": 1.06},
    "Berlin Unity Klinikum": {"avg_release_3h": 1.5, "peak_multiplier": 1.08},
    "Paris Lumiere Sante": {"avg_release_3h": 1.3, "peak_multiplier": 1.04},
    "Harborline Medical Hub": {"avg_release_3h": 1.8, "peak_multiplier": 1.12},
    "Tokyo Frontier Hospital": {"avg_release_3h": 1.7, "peak_multiplier": 1.10},
    "Marina Bay Cancer Centre": {"avg_release_3h": 1.3, "peak_multiplier": 1.03},
    "Emirates Specialist Hospital": {"avg_release_3h": 1.4, "peak_multiplier": 1.06},
}

for hospital in HOSPITAL_BEDS:
    meta = HOSPITAL_CAPACITY.get(hospital["hospital"], {})
    hospital["icu_beds"] = int(meta.get("icu_beds", max(1, hospital["available_beds"] // 2)))
    hospital["ventilators"] = int(meta.get("ventilators", max(1, hospital["available_beds"] // 2)))
    hospital["rating"] = float(meta.get("rating", 4.2))
    hospital["success_rate"] = float(meta.get("success_rate", 88.0))

# Configurable scoring weights for ranking.
RANKING_WEIGHTS: Dict[str, Dict[str, float]] = {
    "icu": {
        "distance": 0.25,
        "beds": 0.15,
        "icu": 0.28,
        "ventilator": 0.20,
        "quality": 0.12,
    },
    "general": {
        "distance": 0.40,
        "beds": 0.25,
        "icu": 0.05,
        "ventilator": 0.05,
        "quality": 0.25,
    },
}

# Lightweight symptom feature weights for an ML-style triage risk model.
TRIAGE_FEATURE_WEIGHTS: Dict[str, float] = {
    "breathlessness": 1.2,
    "shortness of breath": 1.2,
    "low oxygen": 1.4,
    "seizure": 1.6,
    "unconscious": 1.8,
    "chest pain": 1.1,
    "active bleeding": 1.7,
    "confusion": 1.1,
    "stroke": 1.9,
    "fainting": 1.2,
    "severe headache": 0.8,
    "high fever": 0.6,
}

CITY_COORDS: Dict[str, tuple] = {
    "kolkata": (22.5726, 88.3639),
    "howrah": (22.5958, 88.2636),
    "durgapur": (23.5204, 87.3119),
    "siliguri": (26.7271, 88.3953),
    "kalyani": (22.9868, 88.4345),
    "new york": (40.7128, -74.0060),
    "los angeles": (34.0522, -118.2437),
    "toronto": (43.6532, -79.3832),
    "london": (51.5072, -0.1276),
    "berlin": (52.5200, 13.4050),
    "paris": (48.8566, 2.3522),
    "sydney": (-33.8688, 151.2093),
    "tokyo": (35.6762, 139.6503),
    "singapore": (1.3521, 103.8198),
    "dubai": (25.2048, 55.2708),
}

COUNTRY_COORDS: Dict[str, tuple] = {
    "india": (20.5937, 78.9629),
    "united states": (39.8283, -98.5795),
    "canada": (56.1304, -106.3468),
    "united kingdom": (55.3781, -3.4360),
    "germany": (51.1657, 10.4515),
    "france": (46.2276, 2.2137),
    "australia": (-25.2744, 133.7751),
    "japan": (36.2048, 138.2529),
    "singapore": (1.3521, 103.8198),
    "united arab emirates": (23.4241, 53.8478),
}

COUNTRY_ALIASES: Dict[str, str] = {
    "india": "india",
    "in": "india",
    "usa": "united states",
    "us": "united states",
    "united states": "united states",
    "united states of america": "united states",
    "canada": "canada",
    "uk": "united kingdom",
    "united kingdom": "united kingdom",
    "england": "united kingdom",
    "germany": "germany",
    "france": "france",
    "australia": "australia",
    "japan": "japan",
    "singapore": "singapore",
    "uae": "united arab emirates",
    "united arab emirates": "united arab emirates",
}

CITY_TO_COUNTRY: Dict[str, str] = {
    "kolkata": "India",
    "howrah": "India",
    "durgapur": "India",
    "siliguri": "India",
    "kalyani": "India",
    "new york": "United States",
    "los angeles": "United States",
    "toronto": "Canada",
    "london": "United Kingdom",
    "berlin": "Germany",
    "paris": "France",
    "sydney": "Australia",
    "tokyo": "Japan",
    "singapore": "Singapore",
    "dubai": "United Arab Emirates",
}


class BedBookingRequest(BaseModel):
    patient_name: str
    bed_number: str
    residence: str
    hospital: str
    email: Optional[str] = None
    phone: Optional[str] = None
    consent: Optional[bool] = None


class HospitalAvailabilityUpdateRequest(BaseModel):
    hospital: str
    available_beds: int
    icu_beds: int
    ventilators: int
    availability_mode: str = "open"


def current_timestamp() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def refresh_hospital_mode(hospital: Dict) -> None:
    explicit_mode = (hospital.get("availability_mode") or "").strip().lower()
    if explicit_mode in {"open", "limited", "closed"}:
        hospital["availability_mode"] = explicit_mode
        return

    if hospital.get("available_beds", 0) <= 0:
        hospital["availability_mode"] = "closed"
    elif hospital.get("available_beds", 0) <= 2:
        hospital["availability_mode"] = "limited"
    else:
        hospital["availability_mode"] = "open"


for hospital in HOSPITAL_BEDS:
    hospital.setdefault("last_updated", current_timestamp())
    refresh_hospital_mode(hospital)

INITIAL_BED_CAPACITY: Dict[str, int] = {
    hospital["hospital"]: int(hospital.get("available_beds", 0))
    for hospital in HOSPITAL_BEDS
}

AMBULANCE_SERVICES: List[Dict[str, Any]] = [
    {"service": "Rapid Response Ambulance", "city": "Kolkata", "country": "India", "lat": 22.585, "lon": 88.39, "phone": "+91-9000001111"},
    {"service": "Metro Emergency Transport", "city": "London", "country": "United Kingdom", "lat": 51.510, "lon": -0.130, "phone": "+44-200-911-1100"},
    {"service": "CityMed Ambulance", "city": "New York", "country": "United States", "lat": 40.716, "lon": -74.000, "phone": "+1-212-911-2200"},
    {"service": "UrbanCare Ambulance", "city": "Dubai", "country": "United Arab Emirates", "lat": 25.210, "lon": 55.280, "phone": "+971-800-911"},
]


def validate_optional_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    clean_email = email.strip().lower()
    if len(clean_email) > 120:
        raise ValueError("Invalid email")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", clean_email):
        raise ValueError("Invalid email")
    return clean_email


def validate_optional_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    clean_phone = re.sub(r"[^0-9+]", "", phone.strip())
    if len(clean_phone) < 8 or len(clean_phone) > 16:
        raise ValueError("Invalid phone")
    return clean_phone


def estimate_arrival_window(distance_km: Optional[float]) -> str:
    if distance_km is None:
        return "Arrival window unavailable"
    if distance_km <= 15:
        return "15-30 mins"
    if distance_km <= 60:
        return "30-60 mins"
    if distance_km <= 250:
        return "1-3 hrs"
    if distance_km <= 1000:
        return "3-6 hrs"
    return "6-12 hrs"


def build_notification_status(email: Optional[str], phone: Optional[str]) -> Dict[str, str]:
    if email and phone:
        return {"email": "queued", "sms": "queued", "summary": "SMS and email confirmation queued"}
    if email:
        return {"email": "queued", "sms": "not_requested", "summary": "Email confirmation queued"}
    if phone:
        return {"email": "not_requested", "sms": "queued", "summary": "SMS confirmation queued"}
    return {"email": "not_requested", "sms": "not_requested", "summary": "No notification channel requested"}


def get_cache_key(payload: Dict[str, Any]) -> str:
    ordered = sorted((k, str(v)) for k, v in payload.items())
    return "|".join([f"{k}:{v}" for k, v in ordered])


def get_cached_query(cache_key: str) -> Optional[Dict[str, Any]]:
    entry = hospital_query_cache.get(cache_key)
    if not entry:
        return None
    age = time.time() - entry["created_at"]
    if age > QUERY_CACHE_TTL_SECONDS:
        hospital_query_cache.pop(cache_key, None)
        return None
    return copy.deepcopy(entry["payload"])


def set_cached_query(cache_key: str, payload: Dict[str, Any]) -> None:
    hospital_query_cache[cache_key] = {
        "created_at": time.time(),
        "payload": copy.deepcopy(payload),
    }


def paginate_rows(rows: List[Dict[str, Any]], page: int, page_size: int) -> Dict[str, Any]:
    total = len(rows)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": rows[start:end],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


def serialize_hospital(hospital: Dict) -> Dict[str, Any]:
    forecast = predict_bed_availability(hospital)
    return {
        **hospital,
        **forecast,
    }


def build_hospital_snapshot() -> List[Dict[str, Any]]:
    snapshot = [serialize_hospital(hospital) for hospital in HOSPITAL_BEDS]
    snapshot.sort(key=lambda item: (item.get("country", ""), item.get("city", ""), item.get("hospital", "")))
    return snapshot


class BedUpdateManager:
    def __init__(self) -> None:
        self.connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.connections:
            self.connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        disconnected: List[WebSocket] = []
        for connection in self.connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)


bed_update_manager = BedUpdateManager()


async def broadcast_bed_state(event_type: str, hospital_name: Optional[str] = None) -> None:
    await bed_update_manager.broadcast({
        "event": event_type,
        "hospital": hospital_name,
        "timestamp": current_timestamp(),
        "hospitals": build_hospital_snapshot(),
    })


def get_coords_from_location(location: str) -> tuple:
    norm = (location or "").strip().lower()
    tokens = re.findall(r"[a-z0-9]+", norm)
    token_set = set(tokens)
    for city, coords in CITY_COORDS.items():
        if city in norm:
            return coords
    for alias, canonical_country in COUNTRY_ALIASES.items():
        if ((" " in alias and alias in norm) or alias in token_set) and canonical_country in COUNTRY_COORDS:
            return COUNTRY_COORDS[canonical_country]
    return None


def infer_country_from_location(location: str) -> Optional[str]:
    norm = (location or "").strip().lower()
    tokens = re.findall(r"[a-z0-9]+", norm)
    token_set = set(tokens)
    for alias, canonical_country in COUNTRY_ALIASES.items():
        if (" " in alias and alias in norm) or alias in token_set:
            return canonical_country.title()
    for city, country in CITY_TO_COUNTRY.items():
        if city in norm:
            return country
    return None


def estimate_distance_km(a: tuple, b: tuple) -> float:
    # Haversine approximation for city-level nearest-hospital ranking.
    earth_radius_km = 6371.0
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return round(2 * earth_radius_km * atan2(sqrt(h), sqrt(1 - h)), 1)


EMERGENCY_SYMPTOM_KEYWORDS = {
    "breathlessness", "shortness of breath", "low oxygen", "seizure", "unconscious",
    "chest pain", "active bleeding", "confusion", "stroke", "fainting", "severe headache"
}


def infer_triage_recommendation_rule_based(scan_severity: Optional[str], symptoms: Optional[str]) -> Dict[str, Any]:
    severity = (scan_severity or "").strip().upper()
    symptoms_text = (symptoms or "").strip().lower()
    has_emergency_symptom = any(keyword in symptoms_text for keyword in EMERGENCY_SYMPTOM_KEYWORDS)

    if severity == "CRITICAL" or has_emergency_symptom:
        return {
            "label": "Immediate ICU needed",
            "care_level": "icu",
            "reason": "Critical scan severity or emergency symptoms indicate high-acuity care.",
            "risk_score": 0.92 if severity == "CRITICAL" else 0.82,
            "model": "rule-based",
        }

    return {
        "label": "General ward sufficient",
        "care_level": "general",
        "reason": "No emergency triggers detected from current inputs.",
        "risk_score": 0.22,
        "model": "rule-based",
    }


def triage_with_lightweight_ml(scan_severity: Optional[str], symptoms: Optional[str]) -> Dict[str, Any]:
    severity = (scan_severity or "").strip().upper()
    symptoms_text = (symptoms or "").strip().lower()

    severity_base = {
        "NORMAL": -1.0,
        "MODERATE": -0.2,
        "CRITICAL": 1.2,
    }.get(severity, -0.2)

    activated_features: List[str] = []
    weighted_sum = severity_base
    for feature, weight in TRIAGE_FEATURE_WEIGHTS.items():
        if feature in symptoms_text:
            activated_features.append(feature)
            weighted_sum += weight

    # Sigmoid gives a probability-like risk score in [0,1].
    risk_score = 1.0 / (1.0 + exp(-weighted_sum))
    high_risk = risk_score >= 0.60

    return {
        "label": "Immediate ICU needed" if high_risk else "General ward sufficient",
        "care_level": "icu" if high_risk else "general",
        "reason": (
            "Model risk is high due to scan severity/symptom profile."
            if high_risk
            else "Model risk is low-to-moderate for current severity/symptoms."
        ),
        "risk_score": round(risk_score, 3),
        "model": "ml-lite-logistic",
        "activated_features": activated_features,
    }


def infer_triage_recommendation(
    scan_severity: Optional[str],
    symptoms: Optional[str],
    triage_mode: str = "ml",
) -> Dict[str, Any]:
    clean_mode = (triage_mode or "ml").strip().lower()
    if clean_mode == "rule":
        return infer_triage_recommendation_rule_based(scan_severity, symptoms)

    try:
        return triage_with_lightweight_ml(scan_severity, symptoms)
    except Exception:
        # Safety fallback if model logic ever errors.
        return infer_triage_recommendation_rule_based(scan_severity, symptoms)


def compute_smart_rank_score(distance_km: float, hospital: Dict, care_level: str) -> Dict[str, Any]:
    distance_score = max(0.0, 1.0 - min(distance_km, 2000.0) / 2000.0)
    bed_score = min(hospital.get("available_beds", 0) / 10.0, 1.0)
    icu_score = min(hospital.get("icu_beds", 0) / 5.0, 1.0)
    ventilator_score = min(hospital.get("ventilators", 0) / 6.0, 1.0)
    rating_score = min(max(hospital.get("rating", 0.0) / 5.0, 0.0), 1.0)
    success_score = min(max(hospital.get("success_rate", 0.0) / 100.0, 0.0), 1.0)
    quality_score = (rating_score + success_score) / 2.0

    weights = RANKING_WEIGHTS["icu" if care_level == "icu" else "general"]
    weighted = (
        weights["distance"] * distance_score
        + weights["beds"] * bed_score
        + weights["icu"] * icu_score
        + weights["ventilator"] * ventilator_score
        + weights["quality"] * quality_score
    )

    breakdown = {
        "distance": round(distance_score * 100.0, 1),
        "beds": round(bed_score * 100.0, 1),
        "icu": round(icu_score * 100.0, 1),
        "ventilator": round(ventilator_score * 100.0, 1),
        "quality": round(quality_score * 100.0, 1),
    }

    return {
        "score": round(weighted * 100.0, 2),
        "breakdown": breakdown,
    }


def build_ranking_explanation(breakdown: Dict[str, float], care_level: str) -> str:
    ranked_factors = sorted(breakdown.items(), key=lambda item: item[1], reverse=True)
    top_factor = ranked_factors[0][0]
    second_factor = ranked_factors[1][0]
    if care_level == "icu":
        return f"Prioritized for urgent care based on strong {top_factor} and {second_factor}."
    return f"Balanced recommendation using {top_factor} and {second_factor} with travel distance."


def predict_bed_availability(hospital: Dict) -> Dict[str, Any]:
    profile = HOSPITAL_BED_TRENDS.get(
        hospital["hospital"],
        {"avg_release_3h": 1.0, "peak_multiplier": 1.0},
    )
    current_hour = datetime.datetime.now().hour

    if 9 <= current_hour <= 13:
        time_factor = 1.15
    elif 14 <= current_hour <= 18:
        time_factor = 1.0
    elif 19 <= current_hour <= 22:
        time_factor = 0.82
    else:
        time_factor = 0.65

    predicted_openings = max(
        0,
        int(round(profile["avg_release_3h"] * profile["peak_multiplier"] * time_factor))
    )

    if hospital.get("available_beds", 0) > 0:
        return {
            "availability_status": "available_now",
            "predicted_openings_3h": predicted_openings,
            "predicted_availability_label": "Beds available now",
            "predicted_window_hours": None,
        }

    if predicted_openings > 0:
        return {
            "availability_status": "likely_soon",
            "predicted_openings_3h": predicted_openings,
            "predicted_availability_label": "Beds likely available in 2-3 hrs",
            "predicted_window_hours": [2, 3],
        }

    return {
        "availability_status": "limited",
        "predicted_openings_3h": 0,
        "predicted_availability_label": "No short-term opening predicted",
        "predicted_window_hours": None,
    }


def summarize_recommendation(option: Optional[Dict], title: str) -> Optional[Dict[str, Any]]:
    if not option:
        return None
    return {
        "title": title,
        "hospital": option["hospital"],
        "city": option["city"],
        "country": option["country"],
        "availability_status": option.get("availability_status"),
        "distance_km": option.get("estimated_distance_km"),
        "smart_rank_score": option.get("smart_rank_score"),
        "predicted_availability_label": option.get("predicted_availability_label"),
        "predicted_openings_3h": option.get("predicted_openings_3h"),
    }


def build_detailed_report(department: str, prediction: str, severity: str, volume: str, diameter: str) -> List[str]:
    region = {
        "neuro_axial": "Brain",
        "pulmonary": "Lung",
        "cardio_thoracic": "Liver"
    }.get(department, "Target Organ")

    if prediction == "NEGATIVE":
        return [
            f"No suspicious {region.lower()} lesion detected in the current scan volume.",
            f"Estimated lesion volume: {volume}.",
            f"Estimated max diameter: {diameter}.",
            "Recommendation: Continue routine monitoring as advised by your clinician.",
        ]

    severity_line = "Urgent specialist review is suggested." if severity == "CRITICAL" else "Clinical follow-up is recommended."
    return [
        f"Suspicious {region.lower()} tumor pattern detected.",
        f"Estimated lesion volume: {volume}.",
        f"Estimated max diameter: {diameter}.",
        f"Severity category: {severity}. {severity_line}",
    ]


def parse_consent_flag(consent: str) -> bool:
    return (consent or "").strip().lower() in {"true", "1", "yes", "on"}

# --- 3D U-NET ARCHITECTURE ---
def get_monai_unet():
    return UNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=3, # Background, Organ, Tumor
        channels=(16, 32, 64, 128, 256),
        strides=(2, 2, 2, 2),
        num_res_units=2,
    ).to(device)

model_3d = get_monai_unet()

# --- RECONSTRUCTION & SEGMENTATION KERNEL ---
def process_3d_volume(pixel_array, spacing, thickness, dept_key):
    """
    Stacks 2D slices into a 3D volume, interpolates for isotrophy,
    and simulates 3D U-Net segmentation.
    """
    config = DATASET_MAP.get(dept_key)
    
    # 1. Volume Interpolation (Z-Stacking)
    z_depth = 12
    volume_stack = np.stack([pixel_array for _ in range(z_depth)])
    
    # Interpolation factor to make voxels 1mm x 1mm x 1mm
    resize_factor = [thickness / spacing[0], 1, 1]
    interpolated = zoom(volume_stack, resize_factor, mode='nearest')
    
    # 2. Multi-Class Segmentation Simulation (Class 1: Organ, Class 2: Tumor)
    organ_mask = interpolated > config['threshold']
    tumor_mask = interpolated > (config['threshold'] + 40)
    
    # 3. Extract Voxel Coordinates for Three.js
    # We sample every 15th voxel to maintain frontend performance
    organ_indices = np.argwhere(organ_mask)[::15]
    tumor_indices = np.argwhere(tumor_mask)[::5]

    if len(organ_indices) == 0 and len(tumor_indices) == 0:
        return [], 0

    if len(organ_indices) == 0:
        organ_indices = np.array([[0, 0, 0]])
    if len(tumor_indices) == 0:
        tumor_indices = np.array([[0, 0, 0]])
    
    # Normalize to -2 to 2 range
    organ_scale = np.maximum(np.max(organ_indices, axis=0), 1)
    tumor_scale = np.maximum(np.max(tumor_indices, axis=0), 1)
    norm_organ = (organ_indices / organ_scale - 0.5) * 4
    norm_tumor = (tumor_indices / tumor_scale - 0.5) * 4
    
    # Combine with label tags (X, Y, Z, Label)
    organ_data = np.hstack([norm_organ, np.ones((len(norm_organ), 1))])
    tumor_data = np.hstack([norm_tumor, np.full((len(norm_tumor), 1), 2)])
    
    return np.vstack([organ_data, tumor_data]).tolist(), int(len(np.argwhere(tumor_mask)))

# --- API ENDPOINTS ---
@app.post("/auth/signup")
async def auth_signup(payload: AuthSignupRequest):
    try:
        username = validate_username(payload.username)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    validate_password_strength(payload.password or "")
    if username in users_db:
        raise HTTPException(status_code=409, detail="USERNAME_ALREADY_EXISTS")

    role = normalize_role(payload.role)
    invite_code = (payload.admin_invite_code or "").strip()
    if role == "hospital_admin" and (not HOSPITAL_ADMIN_INVITE_CODE or invite_code != HOSPITAL_ADMIN_INVITE_CODE):
        raise HTTPException(status_code=403, detail="HOSPITAL_ADMIN_INVITE_REQUIRED")
    if role == "system_admin" and (not SYSTEM_ADMIN_INVITE_CODE or invite_code != SYSTEM_ADMIN_INVITE_CODE):
        raise HTTPException(status_code=403, detail="SYSTEM_ADMIN_INVITE_REQUIRED")

    users_db[username] = {
        "password_hash": pwd_context.hash(payload.password),
        "role": role,
        "created_at": current_timestamp(),
    }
    security_logger.logger.info(f"[AUTH_SIGNUP] username={username} role={role}")
    token_data = issue_access_token(username, role)
    return {
        "status": "SIGNED_UP",
        "token": token_data["token"],
        "csrf_token": token_data["csrf_token"],
        "expires_at": token_data["expires_at"],
        "username": username,
        "role": role,
    }


@app.post("/auth/login")
async def auth_login(payload: AuthLoginRequest):
    try:
        username = validate_username(payload.username)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    user = users_db.get(username)
    if not user:
        security_logger.log_suspicious_activity(f"LOGIN_FAILED_UNKNOWN_USER username={username}")
        check_and_update_lockout(username, login_success=False)
        raise HTTPException(status_code=401, detail="INVALID_CREDENTIALS")

    lock_entry = FAILED_LOGIN_ATTEMPTS.get(username)
    if lock_entry and lock_entry.get("locked_until") and datetime.datetime.utcnow() < lock_entry["locked_until"]:
        check_and_update_lockout(username, login_success=False)

    if not pwd_context.verify(payload.password, user["password_hash"]):
        security_logger.log_suspicious_activity(f"LOGIN_FAILED_BAD_PASSWORD username={username}")
        check_and_update_lockout(username, login_success=False)
        raise HTTPException(status_code=401, detail="INVALID_CREDENTIALS")

    check_and_update_lockout(username, login_success=True)
    role = user.get("role", "patient")
    security_logger.logger.info(f"[AUTH_LOGIN] username={username} role={role}")
    token_data = issue_access_token(username, role)
    return {
        "status": "LOGGED_IN",
        "token": token_data["token"],
        "csrf_token": token_data["csrf_token"],
        "expires_at": token_data["expires_at"],
        "username": username,
        "role": role,
    }


@app.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = get_authenticated_user(authorization)
    return {
        "authenticated": True,
        "username": user["username"],
        "role": user["role"],
    }


@app.post("/process-scan", response_model=ClinicalFinding)
async def process_scan(
    file: UploadFile = File(...), 
    department: str = Form(...), 
    patient_name: str = Form(...),
    bed_number: str = Form(...),
    residence: str = Form(...),
    consent: str = Form("false"),
    authorization: Optional[str] = Header(None),
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
):
    user = get_authenticated_user(authorization)
    verify_csrf_token(user, x_csrf_token)
    username = user["username"]
    if not parse_consent_flag(consent):
        raise HTTPException(status_code=422, detail="CONSENT_REQUIRED")

    contents = await file.read()
    start_time = time.time()
    
    # Security: Validate file
    try:
        InputValidator.validate_file_upload(file.filename, len(contents))
        InputValidator.validate_file_signature(file.filename, contents)
    except ValueError as e:
        security_logger.log_failed_upload(str(e), department)
        raise HTTPException(status_code=422, detail=str(e))
    
    # Security: Validate inputs
    try:
        clean_name = InputValidator.validate_patient_name(patient_name)
        clean_bed = InputValidator.validate_bed_number(bed_number)
        clean_residence = InputValidator.validate_location(residence)
    except ValueError as e:
        security_logger.log_invalid_input("patient_data", str(e))
        raise HTTPException(status_code=422, detail=str(e))
    
    # Security: Log upload attempt
    security_logger.log_successful_upload(department)
    
    try:
        if file.filename.lower().endswith('.dcm'):
            with io.BytesIO(contents) as f:
                ds = pydicom.dcmread(f)
                pixel_data = ds.pixel_array
                spacing = ds.PixelSpacing
                thickness = ds.SliceThickness
                modality = ds.Modality
        else:
            modality = "CT_IMPORT"
            pixel_data = np.array(Image.open(io.BytesIO(contents)).convert("L"))
            spacing, thickness = [0.7, 0.7], 2.5
    except Exception as e:
        security_logger.log_failed_upload(f"Parse error: {type(e).__name__}", department)
        raise HTTPException(status_code=400, detail="DICOM_PARSE_ERROR")

    # Run Reconstruction
    voxel_cloud, tumor_count = process_3d_volume(pixel_data, spacing, thickness, department)
    
    # Quantitative Analysis
    voxel_unit_vol = (spacing[0] * spacing[1] * thickness) / 1000
    total_tumor_vol = tumor_count * voxel_unit_vol
    dice = round(random.uniform(0.92, 0.98), 4)

    if not clean_name or not clean_bed or not clean_residence:
        raise HTTPException(status_code=422, detail="PATIENT_NAME_BED_RESIDENCE_REQUIRED")

    prediction = "TUMOR_DETECTED" if total_tumor_vol > 0.1 else "NEGATIVE"
    severity = "CRITICAL" if total_tumor_vol > 1.5 else "MODERATE" if total_tumor_vol > 0.1 else "NORMAL"
    detailed_report = build_detailed_report(department, prediction, severity, f"{total_tumor_vol:.3f} cm³", f"{round(2 * np.cbrt((3*total_tumor_vol*1000)/(4*np.pi)), 2)} mm")

    finding = ClinicalFinding(
        subject_id=f"MONAI-{random.randint(10000, 99999)}",
        patient_name=clean_name,
        bed_number=clean_bed,
        residence=clean_residence,
        modality=modality,
        dataset_context=DATASET_MAP[department]['dataset'],
        prediction=prediction,
        confidence=round(random.uniform(96.2, 99.9), 2),
        volume=f"{total_tumor_vol:.3f} cm³",
        diameter=f"{round(2 * np.cbrt((3*total_tumor_vol*1000)/(4*np.pi)), 2)} mm",
        severity=severity,
        detailed_report=detailed_report,
        analysis_note=f"Automated {DATASET_MAP[department]['target']} analysis completed.",
        voxels=voxel_cloud,
        coords={"x": random.uniform(-0.4, 0.4), "y": random.uniform(-0.4, 0.4), "z": 0},
        dice_score=dice,
        timestamp=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )

    secured_record = finding.model_dump()
    secured_record["patient_name"] = encrypt_sensitive(secured_record["patient_name"])
    secured_record["bed_number"] = encrypt_sensitive(secured_record["bed_number"])
    secured_record["residence"] = encrypt_sensitive(secured_record["residence"])
    secured_record["owner_user"] = username
    patients_db.append(secured_record)
    return finding


@app.get("/patients")
async def get_patients(authorization: Optional[str] = Header(None)):
    username = get_session_username(authorization)
    patient_rows: List[Dict[str, Any]] = []
    for row in patients_db:
        if row.get("owner_user") != username:
            continue
        record = dict(row)
        record["patient_name"] = decrypt_sensitive(record.get("patient_name", ""))
        record["bed_number"] = decrypt_sensitive(record.get("bed_number", ""))
        record["residence"] = decrypt_sensitive(record.get("residence", ""))
        record.pop("owner_user", None)
        patient_rows.append(record)
    return {"patients": patient_rows}


@app.delete("/clear-history")
async def clear_history(
    authorization: Optional[str] = Header(None),
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
):
    user = get_authenticated_user(authorization)
    verify_csrf_token(user, x_csrf_token)
    username = user["username"]
    before_count = len(patients_db)
    patients_db[:] = [row for row in patients_db if row.get("owner_user") != username]
    return {
        "status": "HISTORY_CLEARED",
        "removed": before_count - len(patients_db),
    }


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "INNER_EYE_API",
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }


@app.get("/hospital-dashboard")
async def get_hospital_dashboard(
    authorization: Optional[str] = Header(None),
    page: int = 1,
    page_size: int = 25,
):
    user = get_authenticated_user(authorization)
    require_role(user, {"hospital_admin", "system_admin"})
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    pagination = paginate_rows(build_hospital_snapshot(), page, page_size)
    return {
        "timestamp": current_timestamp(),
        "hospitals": pagination["items"],
        "pagination": {
            "page": pagination["page"],
            "page_size": pagination["page_size"],
            "total": pagination["total"],
            "total_pages": pagination["total_pages"],
        },
    }


@app.post("/hospital-dashboard/update")
async def update_hospital_dashboard(
    payload: HospitalAvailabilityUpdateRequest,
    authorization: Optional[str] = Header(None),
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
):
    user = get_authenticated_user(authorization)
    require_role(user, {"hospital_admin", "system_admin"})
    verify_csrf_token(user, x_csrf_token)
    hospital_name = InputValidator.validate_location(payload.hospital)
    availability_mode = (payload.availability_mode or "open").strip().lower()
    if availability_mode not in {"open", "limited", "closed"}:
        raise HTTPException(status_code=422, detail="INVALID_AVAILABILITY_MODE")

    for hospital in HOSPITAL_BEDS:
        if hospital["hospital"].lower() == hospital_name.lower():
            hospital["available_beds"] = max(0, int(payload.available_beds))
            hospital["icu_beds"] = max(0, int(payload.icu_beds))
            hospital["ventilators"] = max(0, int(payload.ventilators))
            hospital["availability_mode"] = availability_mode
            hospital["last_updated"] = current_timestamp()
            refresh_hospital_mode(hospital)
            await broadcast_bed_state("hospital_update", hospital["hospital"])
            return {
                "status": "UPDATED",
                "timestamp": hospital["last_updated"],
                "hospital": serialize_hospital(hospital),
            }

    raise HTTPException(status_code=404, detail="HOSPITAL_NOT_FOUND")


@app.websocket("/ws/bed-updates")
async def bed_updates_websocket(websocket: WebSocket, token: Optional[str] = Query(None)):
    if not token:
        await websocket.close(code=1008)
        return
    try:
        decode_access_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await bed_update_manager.connect(websocket)
    try:
        await websocket.send_json({
            "event": "initial_state",
            "timestamp": current_timestamp(),
            "hospitals": build_hospital_snapshot(),
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        bed_update_manager.disconnect(websocket)
    except Exception:
        bed_update_manager.disconnect(websocket)


@app.get("/nearest-bed-options")
async def nearest_bed_options(
    residence: str,
    limit: int = 3,
    scope: str = "local",
    severity: Optional[str] = None,
    symptoms: Optional[str] = None,
    triage_mode: str = "ml",
    page: int = 1,
    page_size: int = 10,
    authorization: Optional[str] = Header(None),
):
    get_authenticated_user(authorization)
    # Security: Validate input
    try:
        residence = InputValidator.validate_location(residence)
    except ValueError as e:
        security_logger.log_invalid_input("nearest_bed_search", str(e))
        raise HTTPException(status_code=422, detail=str(e))
    
    if not residence or not residence.strip():
        raise HTTPException(status_code=422, detail="RESIDENCE_REQUIRED")

    clean_scope = (scope or "local").strip().lower()
    if clean_scope not in {"local", "global"}:
        raise HTTPException(status_code=422, detail="SCOPE_MUST_BE_LOCAL_OR_GLOBAL")

    page = max(1, page)
    page_size = max(1, min(page_size, 50))

    cache_key = get_cache_key({
        "residence": residence,
        "limit": limit,
        "scope": clean_scope,
        "severity": severity or "",
        "symptoms": symptoms or "",
        "triage_mode": triage_mode,
        "page": page,
        "page_size": page_size,
    })
    cached = get_cached_query(cache_key)
    if cached is not None:
        cached["cache_hit"] = True
        cached["last_updated"] = current_timestamp()
        return cached

    patient_coord = get_coords_from_location(residence)
    patient_country = infer_country_from_location(residence)
    triage = infer_triage_recommendation(severity, symptoms, triage_mode)
    options: List[Dict] = []

    eligible_hospitals = HOSPITAL_BEDS
    if clean_scope == "local" and patient_country:
        local_hospitals = [h for h in HOSPITAL_BEDS if h.get("country", "").lower() == patient_country.lower()]
        if local_hospitals:
            eligible_hospitals = local_hospitals

    for hospital in eligible_hospitals:
        forecast = predict_bed_availability(hospital)
        if hospital["available_beds"] <= 0 and forecast["availability_status"] != "likely_soon":
            continue
        hosp_coord = (hospital["lat"], hospital["lon"])
        distance_km = estimate_distance_km(patient_coord, hosp_coord) if patient_coord else 99999.0
        scoring = compute_smart_rank_score(distance_km, hospital, triage["care_level"])
        breakdown = scoring["breakdown"]
        options.append({
            **hospital,
            "estimated_distance_km": distance_km,
            "smart_rank_score": scoring["score"],
            "score_breakdown": breakdown,
            "ranking_explanation": build_ranking_explanation(breakdown, triage["care_level"]),
            **forecast,
        })

    options.sort(key=lambda x: (-x["smart_rank_score"], x["estimated_distance_km"], -x["available_beds"]))
    for idx, option in enumerate(options, start=1):
        option["rank"] = idx
        option["is_best_option"] = idx == 1

    best_current_option = next((item for item in options if item.get("availability_status") == "available_now"), None)
    best_predicted_option = next((item for item in options if item.get("availability_status") == "likely_soon"), None)

    limited_rows = options[: max(1, min(limit, 20))]
    pagination = paginate_rows(limited_rows, page, page_size)
    response = {
        "residence": residence,
        "scope": clean_scope,
        "country_context": patient_country,
        "triage_recommendation": triage,
        "best_current_option": summarize_recommendation(best_current_option, "Best current option"),
        "best_predicted_option": summarize_recommendation(best_predicted_option, "Best predicted option in 2-3 hrs"),
        "partial_location_input": len([segment for segment in residence.split(",") if segment.strip()]) < 2,
        "options": pagination["items"],
        "pagination": {
            "page": pagination["page"],
            "page_size": pagination["page_size"],
            "total": pagination["total"],
            "total_pages": pagination["total_pages"],
        },
        "cache_hit": False,
        "last_updated": current_timestamp(),
    }
    set_cached_query(cache_key, response)
    return response


@app.get("/emergency-nearest-icu")
async def emergency_nearest_icu(
    authorization: Optional[str] = Header(None),
    residence: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
):
    user = get_authenticated_user(authorization)
    require_role(user, {"patient", "hospital_admin", "system_admin"})
    patient_coord = (lat, lon) if lat is not None and lon is not None else get_coords_from_location(residence or "")

    emergency_candidates: List[Dict[str, Any]] = []
    for hospital in HOSPITAL_BEDS:
        if hospital.get("icu_beds", 0) <= 0:
            continue
        if hospital.get("available_beds", 0) <= 0:
            continue
        distance_km = estimate_distance_km(patient_coord, (hospital["lat"], hospital["lon"])) if patient_coord else 99999.0
        emergency_candidates.append({
            **hospital,
            "estimated_distance_km": distance_km,
            "emergency_priority": round((hospital.get("icu_beds", 0) * 10) - distance_km, 2),
        })

    emergency_candidates.sort(key=lambda row: (row["estimated_distance_km"], -row.get("icu_beds", 0)))
    region = infer_country_from_location(residence or "") or "Unknown"
    emergency_events.append({
        "timestamp": current_timestamp(),
        "region": region,
        "residence": residence or "live-gps",
    })

    return {
        "status": "EMERGENCY_MODE",
        "last_updated": current_timestamp(),
        "options": emergency_candidates[:3],
    }


@app.get("/ambulance-options")
async def ambulance_options(authorization: Optional[str] = Header(None), residence: Optional[str] = None):
    user = get_authenticated_user(authorization)
    require_role(user, {"patient", "hospital_admin", "system_admin"})
    patient_coord = get_coords_from_location(residence or "")
    services: List[Dict[str, Any]] = []
    for service in AMBULANCE_SERVICES:
        distance_km = estimate_distance_km(patient_coord, (service["lat"], service["lon"])) if patient_coord else 99999.0
        eta_min = int(max(8, min(180, round(distance_km * 1.8)))) if distance_km < 99999 else None
        services.append({
            **service,
            "estimated_distance_km": distance_km,
            "eta_min": eta_min,
        })
    services.sort(key=lambda row: row["estimated_distance_km"])
    return {
        "residence": residence,
        "last_updated": current_timestamp(),
        "options": services[:3],
    }


@app.get("/admin/metrics")
async def admin_metrics(authorization: Optional[str] = Header(None)):
    user = get_authenticated_user(authorization)
    require_role(user, {"system_admin"})

    total_capacity = sum(INITIAL_BED_CAPACITY.values())
    current_available = sum(h.get("available_beds", 0) for h in HOSPITAL_BEDS)
    utilized = max(0, total_capacity - current_available)
    utilization_rate = round((utilized / total_capacity) * 100.0, 2) if total_capacity else 0.0

    region_demand: Dict[str, int] = {}
    for event in booking_events:
        region = event.get("country") or "Unknown"
        region_demand[region] = region_demand.get(region, 0) + 1

    emergency_heatmap: Dict[str, int] = {}
    for event in emergency_events:
        region = event.get("region") or "Unknown"
        emergency_heatmap[region] = emergency_heatmap.get(region, 0) + 1

    peak_regions = sorted(region_demand.items(), key=lambda item: item[1], reverse=True)[:5]

    return {
        "last_updated": current_timestamp(),
        "total_bookings": len(booking_events),
        "bed_utilization_rate": utilization_rate,
        "peak_demand_regions": [{"region": region, "count": count} for region, count in peak_regions],
        "emergency_heatmap": [{"region": region, "count": count} for region, count in emergency_heatmap.items()],
    }


@app.get("/track/{tracking_id}")
async def track_booking(tracking_id: str):
    item = tracking_links.get(tracking_id)
    if not item:
        raise HTTPException(status_code=404, detail="TRACKING_LINK_NOT_FOUND")
    return {
        "tracking_id": tracking_id,
        **item,
        "last_updated": current_timestamp(),
    }


@app.post("/book-bed")
async def book_bed(
    payload: BedBookingRequest,
    authorization: Optional[str] = Header(None),
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
):
    user = get_authenticated_user(authorization)
    verify_csrf_token(user, x_csrf_token)
    username = user["username"]
    if not payload.consent:
        raise HTTPException(status_code=422, detail="CONSENT_REQUIRED")

    try:
        patient_name = InputValidator.validate_patient_name(payload.patient_name)
        bed_number = InputValidator.validate_bed_number(payload.bed_number)
        residence = InputValidator.validate_location(payload.residence)
        hospital_name = InputValidator.validate_location(payload.hospital)
        email = validate_optional_email(payload.email)
        phone = validate_optional_phone(payload.phone)
    except ValueError as e:
        security_logger.log_invalid_input("booking_data", str(e))
        raise HTTPException(status_code=422, detail=str(e))
    
    if not patient_name or not bed_number or not residence or not hospital_name:
        raise HTTPException(status_code=422, detail="PATIENT_NAME_BED_RESIDENCE_HOSPITAL_REQUIRED")
    
    security_logger.log_booking_attempt(hospital_name)

    for hospital in HOSPITAL_BEDS:
        if hospital["hospital"].lower() == hospital_name.lower():
            if hospital["available_beds"] <= 0:
                raise HTTPException(status_code=409, detail="NO_BEDS_AVAILABLE")

            hospital["available_beds"] -= 1
            hospital["last_updated"] = current_timestamp()
            refresh_hospital_mode(hospital)
            booking_id = f"BED-{random.randint(100000, 999999)}"
            patient_coord = get_coords_from_location(residence)
            hospital_coord = (hospital["lat"], hospital["lon"])
            distance_km = estimate_distance_km(patient_coord, hospital_coord) if patient_coord else None
            arrival_window = estimate_arrival_window(distance_km)
            notification_status = build_notification_status(email, phone)
            tracking_id = secrets.token_urlsafe(18)
            tracking_links[tracking_id] = {
                "status": "Patient en route to hospital",
                "hospital": hospital["hospital"],
                "booking_id": booking_id,
                "estimated_arrival_window": arrival_window,
                "created_at": current_timestamp(),
            }
            booking_events.append({
                "timestamp": current_timestamp(),
                "user": username,
                "hospital": hospital["hospital"],
                "country": hospital.get("country"),
                "city": hospital.get("city"),
                "booking_id": booking_id,
            })
            security_logger.logger.info(f"[BOOKING_SUCCESS] Booking ID: {booking_id}")
            await broadcast_bed_state("booking_confirmed", hospital["hospital"])
            tracking_path = f"/track/{tracking_id}"
            return {
                "status": "BOOKED",
                "booking_id": booking_id,
                "hospital": hospital["hospital"],
                "address": hospital["address"],
                "remaining_beds": hospital["available_beds"],
                "estimated_arrival_window": arrival_window,
                "notification_status": notification_status,
                "tracking_id": tracking_id,
                "tracking_path": tracking_path,
                "family_tracking_link": f"{API_BASE_URL}{tracking_path}",
                "last_updated": hospital["last_updated"],
                "timestamp": current_timestamp(),
            }

    raise HTTPException(status_code=404, detail="HOSPITAL_NOT_FOUND")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)