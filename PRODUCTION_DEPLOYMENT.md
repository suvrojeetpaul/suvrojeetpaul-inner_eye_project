# INNER_EYE PRODUCTION DEPLOYMENT GUIDE

## Pre-Deployment Security Checklist

### Phase 1: Environment Preparation (Week 1)

#### Information Security Review
- [ ] Security team reviews all code changes
- [ ] HIPAA compliance officer approves data handling
- [ ] Penetration testing completed by external firm
- [ ] Vulnerability scan results reviewed and remediated
- [ ] Security documentation reviewed by mentor/supervisor

#### Infrastructure Review
- [ ] Docker images scanned for vulnerabilities
- [ ] Base images using latest secure versions
- [ ] Database credentials not in repos
- [ ] API keys and secrets stored in secure vault
- [ ] SSL/TLS certificates obtained and configured

#### Configuration Audit
- [ ] .env production values finalized
- [ ] JWT_SECRET is 32+ character random string
- [ ] API_KEY is strong and unique
- [ ] ALLOWED_ORIGINS restricted to production URL only
- [ ] LOG_LEVEL set to INFO (not DEBUG)
- [ ] ENCRYPT_SENSITIVE_DATA set to true
- [ ] LOG_SENSITIVE_DATA set to false
- [ ] RATE_LIMIT_REQUESTS adjusted for expected traffic

---

### Phase 2: Production Environment Setup (Week 2)

#### Backend Deployment

```bash
# 1. Prepare production environment
cd backend

# 2. Copy template and edit securely
cp .env.example .env.production
# Edit with secure values (NOT in version control)
nano .env.production

# 3. Generate production secrets
python -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(32))"
python -c "import secrets; print('API_KEY=' + secrets.token_urlsafe(24))"

# 4. Set up secure database connection
# Use environment variables, not connection strings in code

# 5. Install production dependencies
pip install -r requirements.txt
pip install gunicorn  # Production WSGI server

# 6. Run backend with production settings
gunicorn -w 4 -b 0.0.0.0:8000 main:app \
  --env ENVIRONMENT=production \
  --env CONFIG_FILE=/path/to/.env.production \
  --timeout 30 \
  --error-logfile /var/log/inner-eye-error.log \
  --access-logfile /var/log/inner-eye-access.log
```

#### Frontend Deployment

```bash
# 1. Prepare frontend for production
cd frontend/medical-ui

# 2. Build optimized version
npm run build

# 3. Verify security headers in build
# Check that security.js is bundled

# 4. Deploy to CDN or web server
# Ensure HTTPS is enabled
# Set Security headers (see nginx config below)

# 5. Configure caching
# Static assets: 1 year cache
# HTML files: No cache (always fetch latest)
```

#### Nginx Configuration (Web Server)

```nginx
# /etc/nginx/sites-available/inner-eye-prod

upstream inner_eye_backend {
    server 127.0.0.1:8000;
}

server {
    listen 443 ssl http2;
    server_name inner-eye.hospital.com;

    # SSL Configuration
    ssl_certificate /etc/ssl/certs/inner-eye.crt;
    ssl_certificate_key /etc/ssl/private/inner-eye.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=general:10m rate=100r/m;
    limit_req_zone $binary_remote_addr zone=api:10m rate=500r/m;

    # Frontend
    location / {
        limit_req zone=general burst=20 nodelay;
        root /var/www/inner-eye-prod/build;
        try_files $uri /index.html;
        
        # No caching for index.html
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # Static assets (cache for 1 year)
    location /static/ {
        limit_req zone=general burst=50 nodelay;
        root /var/www/inner-eye-prod/build;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API proxy
    location /api/ {
        limit_req zone=api burst=100 nodelay;
        proxy_pass http://inner_eye_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    # Deny access to sensitive files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    location ~ ~$ {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Logging
    access_log /var/log/nginx/inner-eye-access.log combined;
    error_log /var/log/nginx/inner-eye-error.log warn;
}

# Redirect HTTP to HTTPS
server {
    listen 80 default_server;
    server_name inner-eye.hospital.com;
    return 301 https://$server_name$request_uri;
}
```

---

### Phase 3: Database Configuration (Week 2)

```bash
# Setup secure database connection

# 1. Create restricted database user
mysql> CREATE USER 'inner_eye_prod'@'127.0.0.1' IDENTIFIED BY '${STRONG_PASSWORD}';

# 2. Grant minimal permissions
mysql> GRANT SELECT, INSERT, UPDATE, DELETE ON inner_eye_prod.* TO 'inner_eye_prod'@'127.0.0.1';

# 3. Revoke dangerous permissions
mysql> REVOKE ALL PRIVILEGES ON *.* FROM 'inner_eye_prod'@'127.0.0.1';

# 4. Set connection string in .env
DATABASE_URL=mysql://inner_eye_prod:${STRONG_PASSWORD}@127.0.0.1:3306/inner_eye_prod?ssl_mode=REQUIRED
```

---

### Phase 4: Monitoring & Logging (Week 3)

#### Log Aggregation Setup

```bash
# Install ELK Stack (Elasticsearch, Logstash, Kibana)
# or use managed service (AWS CloudWatch, Azure Monitor)

# Configure log rotation
sudo nano /etc/logrotate.d/inner-eye

/var/log/inner-eye*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
```

#### Monitoring Configuration

```bash
# Install monitoring agent (Prometheus, Datadog, New Relic)

# Key metrics to monitor:
# - API response time (< 500ms)
# - Error rate (< 1%)
# - Rate limit hits (should be minimal)
# - Failed authentication attempts (spike = attack)
# - Disk space usage (alert at 80%)
# - Memory usage (alert at 85%)
# - CPU usage (alert at 75%)
```

---

### Phase 5: Testing in Production (Week 3-4)

#### Functionality Testing
```bash
# 1. Test all endpoints
./tests/security_validation.py

# 2. Test user workflows
# - Upload DICOM file
# - Search nearby beds
# - Book a bed
# - Generate report
# - Check security logs

# 3. Test error handling
# - Network failures
# - Invalid inputs
# - Large file uploads
# - Concurrent requests
```

#### Security Testing
```bash
# 1. Run OWASP ZAP scan
zaproxy -cmd -quickurl https://inner-eye.hospital.com -quickout report.html

# 2. Test rate limiting
for i in {1..500}; do
  curl -s https://inner-eye.hospital.com/api/beds &
done

# 3. Penetration testing
# Hire external firm to conduct:
# - SQL injection attempts
# - XSS payload testing
# - CSRF attacks
# - Authentication bypass
# - Authorization attacks

# 4. Load testing
# Use Apache JMeter or Locust to simulate 1000+ concurrent users
```

---

### Phase 6: Post-Deployment (Ongoing)

#### Daily Checks
- [ ] Application logs for errors
- [ ] Security logs for suspicious activity
- [ ] Uptime monitoring (99.9%+ required)
- [ ] Performance metrics (response time < 500ms)

#### Weekly Checks
- [ ] Database backups completed successfully
- [ ] Failed authentication attempts trending
- [ ] Rate limit effectiveness
- [ ] False positive alerts reviewed

#### Monthly Checks
- [ ] Security updates available for dependencies
- [ ] Log analysis for anomalies
- [ ] Team training on security updates
- [ ] Compliance review (HIPAA)

#### Quarterly Checks
- [ ] Third-party security audit
- [ ] Penetration testing refresh
- [ ] Disaster recovery drill
- [ ] Documentation updates

#### Annual Checks
- [ ] Comprehensive security review
- [ ] Third-party compliance certification
- [ ] Architecture review for scalability
- [ ] Security policy review and update

---

## Environment Variables for Production

```bash
# backend/.env.production (NEVER commit to version control)

# Security
ENVIRONMENT=production
SECRET_KEY=${GENERATE_RANDOM_32_CHAR}
JWT_SECRET=${GENERATE_RANDOM_32_CHAR}
API_KEY=${GENERATE_RANDOM_32_CHAR}

# CORS - ONLY your production domain
ALLOWED_ORIGINS=https://inner-eye.hospital.com,https://inner-eye-staging.hospital.com

# Rate Limiting - Adjust based on traffic
RATE_LIMIT_REQUESTS=500
RATE_LIMIT_WINDOW_SECONDS=60

# Data Protection
ENCRYPT_SENSITIVE_DATA=true
LOG_SENSITIVE_DATA=false
LOG_LEVEL=INFO

# Database
DATABASE_URL=mysql://inner_eye_prod:${STRONG_PASSWORD}@db.hospital.com:3306/inner_eye_prod?ssl_mode=REQUIRED
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=10

# File Upload
MAX_FILE_SIZE=104857600  # 100MB
UPLOAD_DIRECTORY=/secure/storage/uploads

# Email (for alerts)
SMTP_SERVER=smtp.hospital.com
SMTP_PORT=587
SMTP_USERNAME=${EMAIL_USERNAME}
SMTP_PASSWORD=${EMAIL_PASSWORD}

# Monitoring
SENTRY_DSN=${SENTRY_PROJECT_DSN}
DATADOG_API_KEY=${DATADOG_KEY}

# HIPAA Compliance
HIPAA_AUDIT_ENABLED=true
HIPAA_AUDIT_LOG_PATH=/var/log/hipaa-audit.log
```

---

## Rollback Plan

**If deployment fails:**

```bash
# 1. Immediate rollback
git checkout previous-stable-version
docker pull inner-eye-backend:${PREVIOUS_VERSION}
docker-compose down && docker-compose up -d

# 2. Verify rollback
curl https://inner-eye.hospital.com/health
# Should show: {"status":"healthy","version":"X.X.X"}

# 3. Notify stakeholders
# - Send incident notification to team
# - Document issue in post-mortem
# - Identify root cause

# 4. Prepare hotfix
# - Fix identified issue
# - Test in staging environment
# - Deploy hotfix with new version
```

---

## Incident Response

**If security breach detected:**

```bash
# 1. IMMEDIATE (within 5 minutes)
# Enable verbose logging
# Take application offline if necessary
# Alert security team

# 2. WITHIN 30 MINUTES
# Identify compromised data
# Notify affected users
# Begin forensic analysis

# 3. WITHIN 2 HOURS
# Patch vulnerability
# Change all secrets/credentials
# Deploy patched version

# 4. WITHIN 24 HOURS
# Full security audit completed
# Post-mortem report written
# Lessons learned documented

# 5. REGULATORY NOTIFICATION (72 hours per HIPAA)
# Notify HHS if PII exposed
# Document notification attempt
# Keep records for compliance
```

---

## Security Compliance Verification

### HIPAA Checklist

- [ ] Access controls implemented
- [ ] Audit logs maintained (6 years)
- [ ] Encryption in transit (HTTPS)
- [ ] Encryption at rest (database)
- [ ] Business Associate Agreements signed
- [ ] Privacy Notice published
- [ ] Breach notification plan documented
- [ ] Workforce security training completed
- [ ] Security incident procedures documented
- [ ] Contingency/disaster recovery plan

### OWASP Top 10 Verification

- [ ] A1: Broken Authentication → JWT implemented
- [ ] A2: Broken Access Control → RBAC implemented
- [ ] A3: Sensitive Data Exposure → Encryption enabled
- [ ] A4: XML External Entities → Input validation
- [ ] A5: Broken Access Control → Rate limiting
- [ ] A6: Security Misconfiguration → Security headers
- [ ] A7: Cross-Site Scripting → XSS prevention
- [ ] A8: Insecure Deserialization → Secure parsing
- [ ] A9: Using Components with Known Vulns → Dependency scanning
- [ ] A10: Insufficient Logging → Comprehensive logging

---

## Success Metrics

Track these KPIs post-deployment:

| Metric | Target | Current |
|--------|--------|---------|
| Uptime | 99.9% | |
| Response Time (p95) | < 500ms | |
| Error Rate | < 1% | |
| Failed Auth Attempts | < 10/day | |
| Rate Limit Hits | < 1% of requests | |
| Database Backup Success | 100% | |
| Security Patch Deployment | < 24 hours | |
| Incident Response Time | < 1 hour | |
| User Reports | < 5/week | |
| Security Audit Score | > 90/100 | |

---

## Support & Escalation

### Tier 1 Support (Application Errors)
- Check application logs
- Restart affected service
- Verify database connectivity

### Tier 2 Support (Security Issues)
- Isolate compromised component
- Enable forensic logging
- Notify security team
- Begin incident response

### Tier 3 Support (Compliance)
- Escalate to compliance officer
- Contact legal team
- Prepare regulatory notification
- Document all actions

---

**Last Updated:** March 13, 2026
**Next Review:** Quarter 2 2026
**Prepared By:** Development & Security Team
**Approved By:** [Mentor/Supervisor Name]
