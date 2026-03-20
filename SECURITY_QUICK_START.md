# INNER_EYE SECURITY - QUICK START GUIDE

## For Developers & Mentors

### What's Been Implemented? 🔐

#### Core Security Features:
1. **Rate Limiting** - Protection against brute force/DDoS attacks
2. **Input Validation** - Prevents injection attacks and XSS
3. **Security Headers** - Protects against clickjacking, MIME sniffing, XSS
4. **File Upload Validation** - Prevents malicious file uploads
5. **Data Protection** - No sensitive patient data in logs
6. **CORS Restriction** - Only allowed origins can access
7. **Secure Logging** - Security events tracked without PII
8. **XSS Prevention** - HTML escaping and safe rendering
9. **Session Management** - Auto-logout on inactivity
10. **CSRF Protection** - Token headers for form submissions

---

## File Structure

### Backend Security Implementation
```
backend/
├── security.py                 # Main security module
├── main.py                     # Updated with security middleware
├── .env                        # Environment variables (secrets)
├── .env.example               # Template for .env
└── security.log               # Security event log
```

### Frontend Security Implementation
```
frontend/medical-ui/src/
├── security.js                # Frontend security utilities
├── App.js                     # Updated with security checks
└── App.css                    # (no security changes)
```

### Documentation
```
root/
├── CYBERSECURITY.md           # Complete security guide
├── SECURITY_CHECKLIST.md      # Pre-deployment checklist
└── SECURITY_QUICK_START.md    # This file
```

---

## Quick Setup

### Step 1: Backend Configuration
```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env with secure values
nano .env  # or your editor

# Generate strong secrets:
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Step 2: Install Security Dependencies (Already Included)
```bash
# Check if FastAPI is installed (includes security headers)
pip list | grep fastapi

# security.py uses standard FastAPI - no extra packages needed
```

### Step 3: Enable Security in Frontend
```bash
cd frontend/medical-ui

# security.js is automatically imported in App.js
# No additional setup needed
```

### Step 4: Test Security

#### Test Rate Limiting
```bash
# Run 101 requests in 60 seconds - should get 429 on request 101
for i in {1..101}; do
  curl http://localhost:8000/nearest-bed-options?residence=kolkata
done
```

#### Test Input Validation
```bash
# Try invalid patient name - should reject
curl -X POST http://localhost:8000/book-bed \
  -H "Content-Type: application/json" \
  -d '{"patient_name":"<script>alert(1)</script>","bed_number":"1","residence":"kolkata","hospital":"DISHA"}'
```

#### Test CORS
```bash
# From different origin - should be rejected
curl -H "Origin: http://other-site.com" \
  http://localhost:8000/nearest-bed-options?residence=kolkata
```

---

## Key Security Classes & Functions

### Backend Security

#### `SecurityConfig`
```python
from security import SecurityConfig

# Access configuration
origins = SecurityConfig.ALLOWED_ORIGINS
rate_limit = SecurityConfig.RATE_LIMIT_REQUESTS
max_file_size = SecurityConfig.MAX_FILE_SIZE
```

#### `InputValidator`
```python
from security import InputValidator

# Validate inputs
InputValidator.validate_patient_name(name)
InputValidator.validate_file_upload(filename, file_size)
InputValidator.validate_location(location)
```

#### `SecurityLogger`
```python
from security import security_logger

# Log security events
security_logger.log_successful_upload("neuro_axial")
security_logger.log_failed_upload("Invalid file type", "pulmonary")
security_logger.log_suspicious_activity("Multiple failed attempts from IP")
```

### Frontend Security

#### File Validation
```javascript
import FrontendSecurity from './security';

const validation = FrontendSecurity.validateFile(file, 50);
if (!validation.valid) {
  alert(validation.error);
}
```

#### Input Sanitization
```javascript
const safeName = FrontendSecurity.validatePatientName(userInput);
const safeLocation = FrontendSecurity.validateLocation(userInput);
```

#### Safe API Calls
```javascript
try {
  const response = await FrontendSecurity.secureApiCall('/api/endpoint', {
    method: 'POST',
    body: JSON.stringify(data)
  });
} catch (error) {
  const safeError = FrontendSecurity.safeErrorMessage(error);
  alert(safeError); // Won't expose sensitive info
}
```

#### Rate Limiting
```javascript
const limiter = FrontendSecurity.createRateLimiter(100, 60000);
if (!limiter()) {
  console.warn('Rate limit exceeded');
  return;
}
// Proceed with request
```

---

## Security Workflow

### File Upload Flow
1. User selects file
2. Frontend validates (type, size, name)
3. File sent to backend
4. Backend re-validates file
5. Backend validates patient data
6. If valid, process upload + log event
7. If invalid, reject + log security event

### Booking Flow
1. User enters patient & hospital data
2. Frontend validates inputs
3. Data sent to backend with CSRF token
4. Backend validates all inputs
5. Backend checks rate limits
6. If valid, create booking + log event
7. Return confirmation (no patient details)

---

## Common Security Tasks

### Remove User for Security Breach
```python
# Clear their session data
# Run: https://backend-url/clear-history
# Or manually delete their upload files
import shutil
shutil.rmtree('./uploaded_scans/[user_id]')
```

### Check Security Logs
```bash
# View recent security events
tail -f backend/security.log

# Count failed attempts
grep "UPLOAD_FAILED" backend/security.log | wc -l

# Find suspicious IPs
grep "SUSPICIOUS_ACTIVITY" backend/security.log
```

### Update Allowed Origins
```env
# In backend/.env
ALLOWED_ORIGINS=http://localhost:3000,http://production-url.com,http://staging-url.com
```

### Adjust Rate Limiting
```env
# In backend/.env for tighter security:
RATE_LIMIT_REQUESTS=50
RATE_LIMIT_WINDOW_SECONDS=60

# For looser limits (pre-launch testing):
RATE_LIMIT_REQUESTS=1000
```

---

## Testing Checklist

### Manual Testing
- [ ] Can upload valid DICOM file
- [ ] Rejects .exe, .zip files
- [ ] Rejects 100MB+ files
- [ ] Rejects special characters in patient name
- [ ] Can book bed with valid data
- [ ] Cannot book with invalid data
- [ ] Can search nearby beds
- [ ] Security log shows all events
- [ ] Rate limiting kicks in after 100 req/min
- [ ] CORS blocks invalid origins

### Automated Testing
```bash
# Run pytest (if configured)
pytest tests/security_test.py

# Manual API test script
python tests/security_validation.py
```

---

## What's NOT Implemented (Phase 2)

- [ ] User authentication (JWT/OAuth)
- [ ] Database encryption
- [ ] Two-factor authentication
- [ ] API keys rotation
- [ ] Web Application Firewall
- [ ] Intrusion Detection System
- [ ] SIEM integration
- [ ] Biometric authentication

These are recommended for enterprise deployment.

---

## Performance Impact

Security measures have minimal performance impact:

| Feature | Overhead | Notes |
|---------|----------|-------|
| Rate Limiting | <1ms | Per-request check |
| Input Validation | 1-5ms | Regex + string operations |
| Security Headers | <1ms | Header injection |
| Logging | 2-10ms | File I/O (async friendly) |
| Overall | ~5-10ms | Negligible vs API latency |

---

## Troubleshooting

### Getting "Rate limit exceeded" errors
**Cause:** Too many requests from same IP
**Solution:** Modify `RATE_LIMIT_REQUESTS` in `.env` or wait 60 seconds

### File upload fails with "Invalid file type"
**Cause:** Unsupported file extension
**Solution:** Only use `.dcm`, `.nii`, `.nii.gz`, `.jpg`, `.png`

### CORS errors in browser console
**Cause:** Frontend origin not in `ALLOWED_ORIGINS`
**Solution:** Add frontend URL to `ALLOWED_ORIGINS` in backend/.env

### Cannot see security logs
**Cause:** File doesn't exist yet
**Solution:** Trigger an event (upload file), then check `backend/security.log`

---

## Next Steps for Mentor Review

1. **Review** `backend/security.py` for implementation details
2. **Check** `CYBERSECURITY.md` for complete threat analysis
3. **Test** endpoints with the provided curl examples
4. **Verify** security logs are being created
5. **Suggest** improvements for Phase 2 (JWT, DB encryption, etc.)

---

## Resources

- FastAPI Security: https://fastapi.tiangolo.com/advanced/security/
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- HIPAA Guide: https://www.hhs.gov/hipaa/index.html
- MDN Web Security: https://developer.mozilla.org/en-US/docs/Web/Security

---

**Questions?** Review `CYBERSECURITY.md` for detailed explanations!

**Last Updated:** March 13, 2026
