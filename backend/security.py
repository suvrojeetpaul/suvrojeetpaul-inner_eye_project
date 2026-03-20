"""
INNER_EYE SECURITY MODULE
Comprehensive cybersecurity implementation for medical AI platform
"""

import os
import secrets
import hashlib
import logging
import re
from datetime import datetime, timedelta
from functools import wraps
from typing import Optional, Callable
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
import jwt

# --- SECURITY CONFIGURATION ---
logger = logging.getLogger(__name__)

class SecurityConfig:
    """Security configuration for INNER_EYE platform"""
    
    # JWT Configuration
    JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_urlsafe(32))
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRATION_HOURS = 24
    
    # CORS Configuration - RESTRICT TO TRUSTED ORIGINS ONLY
    ALLOWED_ORIGINS = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
    ).split(",")
    ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    # Allow all headers so browser preflight does not fail on varying header casing/order.
    ALLOWED_HEADERS = ["*"]
    
    # Rate Limiting
    RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
    RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
    RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    
    # File Upload Security
    MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", "52428800"))  # 50MB
    ALLOWED_FILE_EXTENSIONS = {".dcm", ".nii", ".nii.gz", ".jpg", ".png"}
    UPLOAD_DIRECTORY = "./uploaded_scans"
    
    # Data Security
    ENCRYPT_SENSITIVE_DATA = True
    LOG_SENSITIVE_DATA = False  # NEVER log PII
    
    # Session Security
    SESSION_TIMEOUT_MINUTES = 30
    MAX_LOGIN_ATTEMPTS = 5
    LOGIN_TIMEOUT_MINUTES = 15
    ENFORCE_HTTPS = os.getenv("ENFORCE_HTTPS", "false").lower() == "true"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware to prevent abuse"""
    
    def __init__(self, app, requests_per_minute: int = 100):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.client_requests = {}
    
    async def dispatch(self, request: Request, call_next):
        if not SecurityConfig.RATE_LIMIT_ENABLED:
            return await call_next(request)
        
        client_ip = request.client.host
        current_time = datetime.now()
        
        if client_ip not in self.client_requests:
            self.client_requests[client_ip] = []
        
        # Remove old requests outside the window
        self.client_requests[client_ip] = [
            req_time for req_time in self.client_requests[client_ip]
            if (current_time - req_time).seconds < 60
        ]
        
        # Check rate limit
        if len(self.client_requests[client_ip]) >= self.requests_per_minute:
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please try again later."
            )
        
        self.client_requests[client_ip].append(current_time)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses"""
    
    async def dispatch(self, request: Request, call_next):
        if SecurityConfig.ENFORCE_HTTPS:
            forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
            request_scheme = request.url.scheme.lower()
            host = request.client.host if request.client else ""
            is_local = host in {"127.0.0.1", "localhost", "::1"}
            if not is_local and forwarded_proto != "https" and request_scheme != "https":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="HTTPS_REQUIRED"
                )

        response = await call_next(request)
        
        # Security Headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "connect-src 'self' http://127.0.0.1:8000 http://localhost:8000 ws://127.0.0.1:8000 ws://localhost:8000; "
            "img-src 'self' data:; "
            "font-src 'self'"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        return response


class InputValidator:
    """Validate and sanitize user inputs"""
    
    @staticmethod
    def validate_patient_name(name: str) -> str:
        """Validate patient name - alphanumeric and spaces only"""
        if not name or len(name) > 100:
            raise ValueError("Invalid patient name")
        
        # Remove any potentially dangerous characters
        sanitized = "".join(c for c in name if c.isalnum() or c.isspace() or c == "-")
        
        if not sanitized.strip():
            raise ValueError("Patient name contains invalid characters")
        
        return sanitized.strip()
    
    @staticmethod
    def validate_location(location: str) -> str:
        """Validate location/residence"""
        if not location or len(location) > 100:
            raise ValueError("Invalid location")
        
        # Allow alphanumeric, spaces, commas, hyphens
        sanitized = "".join(
            c for c in location 
            if c.isalnum() or c.isspace() or c in ",-"
        )
        
        if not sanitized.strip():
            raise ValueError("Location contains invalid characters")
        
        return sanitized.strip()
    
    @staticmethod
    def validate_bed_number(bed: str) -> str:
        """Validate bed number"""
        if not bed or len(bed) > 20:
            raise ValueError("Invalid bed number")
        
        sanitized = "".join(c for c in bed if c.isalnum() or c == "-")
        
        if not sanitized.strip():
            raise ValueError("Bed number contains invalid characters")
        
        return sanitized.strip()
    
    @staticmethod
    def validate_file_upload(filename: str, file_size: int) -> bool:
        """Validate file upload"""
        # Check file size
        if file_size > SecurityConfig.MAX_FILE_SIZE:
            raise ValueError(f"File too large. Max size: {SecurityConfig.MAX_FILE_SIZE} bytes")
        
        # Check file extension
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext not in SecurityConfig.ALLOWED_FILE_EXTENSIONS:
            raise ValueError(f"Invalid file type. Allowed: {SecurityConfig.ALLOWED_FILE_EXTENSIONS}")
        
        # Prevent directory traversal attacks
        if ".." in filename or "/" in filename or "\\" in filename:
            raise ValueError("Invalid filename")
        
        return True

    @staticmethod
    def validate_file_signature(filename: str, content: bytes) -> bool:
        file_name = (filename or "").lower()
        if file_name.endswith(".png") and not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("INVALID_PNG_SIGNATURE")
        if file_name.endswith(".jpg") or file_name.endswith(".jpeg"):
            if not (content.startswith(b"\xff\xd8\xff") and content.endswith(b"\xff\xd9")):
                raise ValueError("INVALID_JPEG_SIGNATURE")
        if file_name.endswith(".dcm") and len(content) >= 132:
            if content[128:132] != b"DICM":
                raise ValueError("INVALID_DICOM_SIGNATURE")
        return True
    
    @staticmethod
    def validate_text_input(text: str, max_length: int = 500) -> str:
        """Validate and sanitize text input"""
        if not isinstance(text, str):
            raise ValueError("Input must be string")
        
        if len(text) > max_length:
            raise ValueError(f"Input exceeds maximum length of {max_length}")
        
        # Remove null bytes and control characters
        sanitized = "".join(c for c in text if ord(c) >= 32 or c.isspace())
        sanitized = sanitized.replace("<", "").replace(">", "")
        sanitized = re.sub(r"(--|;|/\*|\*/)", "", sanitized)
        
        return sanitized.strip()


class DataEncryption:
    """Handle sensitive data encryption"""
    
    @staticmethod
    def hash_patient_id(patient_id: str) -> str:
        """Hash sensitive patient identifier"""
        return hashlib.sha256(patient_id.encode()).hexdigest()
    
    @staticmethod
    def hash_bed_number(bed_number: str) -> str:
        """Hash bed number for logging"""
        return hashlib.sha256(bed_number.encode()).hexdigest()


class SecurityLogger:
    """Log security events without exposing sensitive data"""
    
    def __init__(self):
        self.logger = logging.getLogger("SECURITY")
        handler = logging.FileHandler("security.log")
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)
    
    def log_successful_upload(self, department: str):
        """Log successful file upload"""
        self.logger.info(f"[UPLOAD_SUCCESS] Department: {department}")
    
    def log_failed_upload(self, reason: str, department: str = "unknown"):
        """Log failed upload attempt"""
        self.logger.warning(f"[UPLOAD_FAILED] Department: {department}, Reason: {reason}")
    
    def log_invalid_input(self, field: str, reason: str):
        """Log invalid input attempts"""
        self.logger.warning(f"[INVALID_INPUT] Field: {field}, Reason: {reason}")
    
    def log_suspicious_activity(self, activity: str):
        """Log suspicious activities"""
        self.logger.warning(f"[SUSPICIOUS_ACTIVITY] {activity}")
    
    def log_api_call(self, endpoint: str, method: str):
        """Log API calls"""
        self.logger.info(f"[API_CALL] {method} {endpoint}")
    
    def log_booking_attempt(self, hospital: str):
        """Log bed booking attempts (without patient details)"""
        self.logger.info(f"[BOOKING_ATTEMPT] Hospital: {hospital}")


# Initialize security logger
security_logger = SecurityLogger()


def require_valid_input(func: Callable) -> Callable:
    """Decorator to validate function inputs"""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except ValueError as e:
            security_logger.log_invalid_input("function_input", str(e))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(e)
            )
    return wrapper


def validate_api_key(api_key: str) -> bool:
    """Validate API key from environment"""
    valid_key = os.getenv("API_KEY", "")
    return api_key == valid_key and bool(valid_key)
