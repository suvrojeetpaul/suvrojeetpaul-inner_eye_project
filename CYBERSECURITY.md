# INNER_EYE CYBERSECURITY IMPLEMENTATION GUIDE

## Overview
This document outlines the comprehensive cybersecurity features implemented in the INNER_EYE medical imaging platform.

---

## 1. BACKEND SECURITY (`backend/security.py`)

### 1.1 Rate Limiting Middleware
- **Purpose:** Prevent brute force attacks and DDoS
- **Configuration:** 100 requests per 60 seconds (configurable)
- **Enforcement:** Per IP address tracking
- **Response:** HTTP 429 (Too Many Requests)

```python
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
```

### 1.2 Security Headers Middleware
- **X-Content-Type-Options:** Prevents MIME sniffing
- **X-Frame-Options:** Prevents clickjacking (DENY)
- **X-XSS-Protection:** Browser XSS filter enablement
- **Strict-Transport-Security:** Enforces HTTPS
- **Content-Security-Policy:** Restricts script/resource loading
- **Referrer-Policy:** Controls referrer information

### 1.3 CORS (Cross-Origin Resource Sharing)
- **Strict Origins:** Only allow trusted origins
- **Default:** http://localhost:3000
- **Configuration:** Environment variable `ALLOWED_ORIGINS`
- **Methods:** GET, POST, PUT, DELETE, OPTIONS
- **Headers:** Content-Type, Authorization, X-CSRF-Token

### 1.4 Input Validation (`InputValidator` class)
Validates and sanitizes all user inputs to prevent injection attacks:

#### Patient Name Validation
- Max 100 characters
- Only alphanumeric, spaces, hyphens
- Removes dangerous characters

#### Location/Residence Validation
- Max 100 characters
- Allows alphanumeric, spaces, commas, hyphens
- Prevents directory traversal

#### Bed Number Validation
- Max 20 characters
- Alphanumeric and hyphens only

#### File Upload Validation
- Max file size: 50MB (configurable)
- Allowed extensions: `.dcm`, `.nii`, `.nii.gz`, `.jpg`, `.png`
- Prevents directory traversal attacks
- Validates filename characters

#### Text Input Validation
- Max 500 characters
- Removes null bytes and control characters
- Trims whitespace

### 1.5 Data Encryption
- **Patient ID Hashing:** SHA-256 for sensitive identifiers
- **Bed Number Hashing:** SHA-256 for logging
- **Sensitive Data:** Not logged or exposed in API responses

### 1.6 Security Logging (`SecurityLogger` class)
Logs security events without exposing PII:

```python
# Successful operations
[UPLOAD_SUCCESS] Department: neuro_axial
[BOOKING_SUCCESS] Booking ID: BED-123456

# Failed attempts
[UPLOAD_FAILED] Department: pulmonary, Reason: Invalid file type
[INVALID_INPUT] Field: patient_name, Reason: Contains special characters

# Suspicious activity
[SUSPICIOUS_ACTIVITY] Description of suspicious behavior
[RATE_LIMIT_EXCEEDED] IP: 192.168.1.1
```

### 1.7 Endpoint Security

#### `/process-scan` (POST)
- Validates file upload
- Validates patient data inputs
- Logs upload attempts
- Prevents information disclosure in error messages

#### `/book-bed` (POST)
- Validates all patient and hospital data
- Logs booking attempts
- No sensitive data in response
- No patient details exposed

#### `/nearest-bed-options` (GET)
- Validates residence input
- Prevents location enumeration attacks
- Safe error messages

---

## 2. FRONTEND SECURITY (`frontend/security.js`)

### 2.1 Input Validation
```javascript
FrontendSecurity.validatePatientName(name)
FrontendSecurity.validateBedNumber(bed)
FrontendSecurity.validateLocation(location)
FrontendSecurity.validateFile(file, maxSizeMB)
```

### 2.2 XSS Prevention
```javascript
FrontendSecurity.sanitizeForDisplay(text)  // Escapes HTML
FrontendSecurity.escapeHtml(text)          // HTML entity encoding
```

### 2.3 Rate Limiting
Client-side rate limiting prevents excessive API calls:
```javascript
const limiter = FrontendSecurity.createRateLimiter(100, 60000);
if (!limiter()) {
  console.warn('Rate limited');
}
```

### 2.4 Secure API Calls
```javascript
await FrontendSecurity.secureApiCall('/api/endpoint', {
  method: 'POST',
  body: JSON.stringify(data)
});
```
- Adds CSRF protection headers
- Sets Content-Type correctly
- Handles errors safely

### 2.5 Safe Error Messages
Never exposes sensitive details:
```javascript
FrontendSecurity.safeErrorMessage(error)
// Returns: "An error occurred. Please try again."
// Never: "Password incorrect" or "User not found"
```

### 2.6 Session Management
- Auto-logout after inactivity
- Configurable timeout (default: 30 minutes)
- Resets on user activity
- Clears sensitive data on logout

### 2.7 Event Logging
Logs only non-sensitive events:
```javascript
FrontendSecurity.logEvent('FILE_UPLOAD', {
  action: 'upload_started',
  status: 'pending'
  // Never includes: patient_name, bed_number, medical data
});
```

### 2.8 Retry Logic
Implements exponential backoff for failed requests:
```javascript
await FrontendSecurity.retryRequest(apiCall, 3, 1000);
```
- Max 3 retries
- Initial delay: 1000ms
- Exponential backoff: 1s, 2s, 4s

---

## 3. DATA PROTECTION

### 3.1 Patient Privacy
- Patient names not stored in responses
- Bed numbers not exposed in API
- Residence location kept confidential
- Medical details protected from logs

### 3.2 HIPAA Considerations
- No protected health information (PHI) in logs
- Secure audit trails for compliance
- Encrypted storage recommended
- Access controls for sensitive endpoints

### 3.3 Data Minimization
- Only collect necessary information
- No patient details in booking confirmation
- Audit logs without PII
- Temporary data cleanup

---

## 4. ENVIRONMENT SETUP

### 4.1 Backend Configuration
Create `.env` file from `.env.example`:

```bash
cp backend/.env.example backend/.env
```

Edit `.env` with secure values:
```env
JWT_SECRET=<generate_strong_random_string>
API_KEY=<generate_strong_random_string>
ALLOWED_ORIGINS=http://localhost:3000
RATE_LIMIT_ENABLED=true
```

### 4.2 Frontend Configuration
No sensitive configuration needed in frontend (all in backend).

---

## 5. SECURITY BEST PRACTICES

### 5.1 Development
- Always use `.env` for secrets
- Never commit credentials
- Enable all security middleware
- Test input validation thoroughly

### 5.2 Production
- Use HTTPS only
- Enable rate limiting
- Configure proper CORS
- Set strong JWT secrets
- Monitor security logs
- Regular security audits
- Keep dependencies updated

### 5.3 Compliance
- HIPAA-ready architecture
- GDPR requestable/deletable data
- Audit trails for compliance
- Data retention policies

---

## 6. THREAT MITIGATION

### Blocked Attack Vectors

| Attack Type | Mitigation |
|---|---|
| SQL Injection | Input validation, parameterized queries |
| XSS (Cross-Site Scripting) | HTML escaping, CSP headers |
| CSRF (Cross-Site Request Forgery) | CSRF token headers |
| XXE (XML External Entity) | File type validation |
| SSRF (Server-Side Request Forgery) | Origin validation |
| Directory Traversal | Filename sanitization |
| Brute Force | Rate limiting |
| DDoS | Rate limiting, CORS |
| Information Disclosure | Safe error messages |
| Sensitive Data Exposure | Encryption, no PII in logs |
| Missing Authentication | (Future: JWT/OAuth integration) |

---

## 7. MONITORING & LOGGING

### 7.1 Security Log Location
```
backend/security.log  - All security events
backend/server.log    - Server activity
```

### 7.2 Log Review
Check security logs daily:
```bash
tail -f backend/security.log
```

### 7.3 Alert Conditions
- Multiple failed uploads from same IP
- Rate limit exceeded
- Invalid input attempts
- File validation failures

---

## 8. FUTURE ENHANCEMENTS

### Phase 2 (Recommended)
- [ ] JWT/OAuth authentication
- [ ] Database encryption (SQLAlchemy)
- [ ] Two-factor authentication (2FA)
- [ ] API key rotation
- [ ] Penetration testing
- [ ] Security headers verification

### Phase 3 (Enterprise)
- [ ] Web Application Firewall (WAF)
- [ ] Intrusion Detection System (IDS)
- [ ] SIEM integration
- [ ] Certificate pinning
- [ ] Hardware security keys
- [ ] Biometric authentication

---

## 9. INCIDENT RESPONSE

### If Security Breach Occurs:
1. Stop vulnerable service immediately
2. Review security.log for breach details
3. Notify affected users
4. Change all secrets in `.env`
5. Restart services with new secrets
6. Review and patch vulnerabilities
7. Conduct post-incident review

---

## 10. RESOURCES

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [HIPAA Compliance](https://www.hhs.gov/hipaa/)
- [FastAPI Security Documentation](https://fastapi.tiangolo.com/advanced/security/)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)

---

**Last Updated:** March 2026
**Status:** Production Ready
**Maintained By:** Security Team
