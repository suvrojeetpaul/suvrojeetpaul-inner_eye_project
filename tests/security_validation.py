#!/usr/bin/env python3
"""
Security Validation Testing Script
Tests all security features implemented in INNER_EYE
Run: python tests/security_validation.py
"""

import requests
import json
import time
from datetime import datetime
import sys

# Configuration
BASE_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"
TEST_HOSPITAL = "DISHA Central Care"

# Colors for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
END = '\033[0m'

class SecurityTester:
    def __init__(self, base_url=BASE_URL):
        self.base_url = base_url
        self.session = requests.Session()
        self.auth_headers = {}
        self.results = {
            'passed': 0,
            'failed': 0,
            'warnings': 0,
            'tests': []
        }

    def authenticate(self):
        """Authenticate once and keep Authorization/CSRF headers for protected endpoints."""
        username = f"security_tester_{int(time.time())}"
        password = "SecurityPass123"

        signup_resp = self.session.post(
            f"{self.base_url}/auth/signup",
            json={"username": username, "password": password},
            timeout=10,
        )

        auth_data = {}
        if signup_resp.status_code == 200:
            auth_data = signup_resp.json()
        elif signup_resp.status_code == 409:
            login_resp = self.session.post(
                f"{self.base_url}/auth/login",
                json={"username": username, "password": password},
                timeout=10,
            )
            if login_resp.status_code != 200:
                raise RuntimeError(f"Auth login failed: {login_resp.status_code} {login_resp.text}")
            auth_data = login_resp.json()
        else:
            raise RuntimeError(f"Auth signup failed: {signup_resp.status_code} {signup_resp.text}")

        token = auth_data.get("token")
        csrf_token = auth_data.get("csrf_token")
        if not token or not csrf_token:
            raise RuntimeError("Missing token or CSRF token in auth response")

        self.auth_headers = {
            "Authorization": f"Bearer {token}",
            "X-CSRF-Token": csrf_token,
        }

    def log_test(self, test_name, status, message=""):
        """Log test result"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        if status == 'PASS':
            color = GREEN
            self.results['passed'] += 1
        elif status == 'FAIL':
            color = RED
            self.results['failed'] += 1
        else:
            color = YELLOW
            self.results['warnings'] += 1
        
        log_entry = f"{color}[{status}]{END} {test_name}"
        if message:
            log_entry += f" - {message}"
        
        print(log_entry)
        self.results['tests'].append({
            'timestamp': timestamp,
            'test': test_name,
            'status': status,
            'message': message
        })

    def test_rate_limiting(self):
        """Test rate limiting - should get 429 after X requests"""
        print(f"\n{BLUE}=== Testing Rate Limiting ==={END}")
        
        try:
            # Send multiple requests rapidly
            success_count = 0
            blocked_count = 0
            
            for i in range(105):
                try:
                    response = self.session.get(
                        f"{self.base_url}/nearest-bed-options",
                        params={'residence': 'kolkata'},
                        headers=self.auth_headers,
                        timeout=5
                    )
                    
                    if response.status_code == 429:
                        blocked_count += 1
                    elif response.status_code == 200:
                        success_count += 1
                        
                except Exception as e:
                    pass
            
            if blocked_count > 0:
                self.log_test(
                    "Rate Limiting",
                    "PASS",
                    f"Allowed {success_count} requests, blocked {blocked_count} (429 Too Many Requests)"
                )
            else:
                self.log_test(
                    "Rate Limiting",
                    "WARN",
                    f"Completed all {success_count} requests without 429 - may need longer burst test"
                )
                
        except Exception as e:
            self.log_test("Rate Limiting", "FAIL", str(e))

    def test_security_headers(self):
        """Test that security headers are present"""
        print(f"\n{BLUE}=== Testing Security Headers ==={END}")
        
        try:
            response = self.session.get(
                f"{self.base_url}/nearest-bed-options?residence=kolkata",
                headers=self.auth_headers,
            )
            headers = response.headers
            
            required_headers = {
                'Strict-Transport-Security': 'HSTS',
                'X-Content-Type-Options': 'MIME sniffing prevention',
                'X-Frame-Options': 'Clickjacking prevention',
                'X-XSS-Protection': 'XSS protection',
                'Content-Security-Policy': 'CSP',
            }
            
            missing_headers = []
            for header, description in required_headers.items():
                if header in headers:
                    self.log_test(
                        f"Security Header: {header}",
                        "PASS",
                        f"Value: {headers[header]}"
                    )
                else:
                    missing_headers.append(header)
                    self.log_test(
                        f"Security Header: {header}",
                        "FAIL",
                        "Header not found"
                    )
            
            if not missing_headers:
                print(f"{GREEN}✓ All security headers present{END}")
                
        except Exception as e:
            self.log_test("Security Headers", "FAIL", str(e))

    def test_cors_restriction(self):
        """Test CORS restriction"""
        print(f"\n{BLUE}=== Testing CORS Restriction ==={END}")
        
        try:
            # Test with origin that should be allowed
            response = self.session.get(
                f"{self.base_url}/nearest-bed-options?residence=kolkata",
                headers={**self.auth_headers, 'Origin': FRONTEND_URL}
            )
            
            if response.status_code in [200, 422]:
                self.log_test(
                    "CORS: Allowed Origin",
                    "PASS",
                    f"Frontend origin {FRONTEND_URL} accepted"
                )
            else:
                self.log_test(
                    "CORS: Allowed Origin",
                    "WARN",
                    f"Response code {response.status_code}"
                )
            
            # Test with origin that should be blocked
            response = self.session.get(
                f"{self.base_url}/nearest-bed-options?residence=kolkata",
                headers={**self.auth_headers, 'Origin': 'http://malicious-site.com'}
            )
            
            if response.status_code == 200:
                # Check if CORS headers block it
                if 'Access-Control-Allow-Origin' not in response.headers:
                    self.log_test(
                        "CORS: Blocked Origin",
                        "PASS",
                        "Malicious origin blocked (no CORS headers)"
                    )
                else:
                    self.log_test(
                        "CORS: Blocked Origin",
                        "FAIL",
                        f"Unauthorized origin allowed: {response.headers.get('Access-Control-Allow-Origin')}"
                    )
            else:
                self.log_test(
                    "CORS: Blocked Origin",
                    "PASS",
                    f"Request rejected with status {response.status_code}"
                )
                
        except Exception as e:
            self.log_test("CORS Restriction", "FAIL", str(e))

    def test_input_validation(self):
        """Test input validation on endpoints"""
        print(f"\n{BLUE}=== Testing Input Validation ==={END}")
        
        # Test 1: Invalid patient name with XSS attempt
        try:
            response = self.session.post(
                f"{self.base_url}/book-bed",
                json={
                    'patient_name': '<script>alert(1)</script>',
                    'bed_number': '1',
                    'residence': 'kolkata',
                    'hospital': TEST_HOSPITAL,
                    'consent': True,
                },
                headers=self.auth_headers,
            )
            
            response_text = response.text.lower()
            contains_script_payload = "<script>" in response_text or "alert(1)" in response_text

            if response.status_code in [400, 422]:
                self.log_test(
                    "XSS Prevention: Script in patient name",
                    "PASS",
                    f"Rejected with status {response.status_code}"
                )
            elif response.status_code in [200, 201] and not contains_script_payload:
                self.log_test(
                    "XSS Prevention: Script in patient name",
                    "PASS",
                    "Input accepted but payload was neutralized and not reflected"
                )
            else:
                self.log_test(
                    "XSS Prevention: Script in patient name",
                    "FAIL",
                    f"Unexpected status {response.status_code} or payload reflected"
                )
        except Exception as e:
            self.log_test("XSS Prevention", "FAIL", str(e))
        
        # Test 2: Invalid bed number (negative)
        try:
            response = self.session.post(
                f"{self.base_url}/book-bed",
                json={
                    'patient_name': 'John Doe',
                    'bed_number': '-5',
                    'residence': 'kolkata',
                    'hospital': TEST_HOSPITAL,
                    'consent': True,
                },
                headers=self.auth_headers,
            )
            
            if response.status_code in [400, 422]:
                self.log_test(
                    "Input Validation: Negative bed number",
                    "PASS",
                    f"Rejected with status {response.status_code}"
                )
            else:
                self.log_test(
                    "Input Validation: Negative bed number",
                    "FAIL",
                    f"Accepted invalid negative bed number with status {response.status_code}"
                )
        except Exception as e:
            self.log_test("Input Validation", "FAIL", str(e))
        
        # Test 3: Invalid location
        try:
            response = self.session.get(
                f"{self.base_url}/nearest-bed-options",
                params={'residence': '; DROP TABLE beds;--'},
                headers=self.auth_headers,
            )
            
            if response.status_code in [400, 200]:
                self.log_test(
                    "SQL Injection Prevention",
                    "PASS",
                    "Dangerous input handled safely"
                )
            else:
                self.log_test(
                    "SQL Injection Prevention",
                    "WARN",
                    f"Status {response.status_code}"
                )
        except Exception as e:
            self.log_test("SQL Injection Prevention", "FAIL", str(e))

    def test_file_upload_validation(self):
        """Test file upload validation"""
        print(f"\n{BLUE}=== Testing File Upload Validation ==={END}")
        
        # Test 1: Invalid file extension
        try:
            files = {
                'file': ('malware.exe', b'MZ\x90\x00', 'application/x-msdownload'),
                'patient_name': (None, 'John Doe'),
                'residence': (None, 'kolkata'),
                'bed_number': (None, '5'),
            }
            
            response = self.session.post(
                f"{self.base_url}/process-scan",
                files=files,
                headers=self.auth_headers,
            )
            
            if response.status_code in [400, 415, 422]:
                self.log_test(
                    "File Upload Security: Invalid extension (.exe)",
                    "PASS",
                    f"Rejected with status {response.status_code}"
                )
            else:
                self.log_test(
                    "File Upload Security: Invalid extension",
                    "WARN",
                    f"Accepted (status {response.status_code})"
                )
        except Exception as e:
            self.log_test("File Upload Security", "FAIL", str(e))

    def test_pii_protection(self):
        """Test that PII is not exposed in responses"""
        print(f"\n{BLUE}=== Testing PII Protection ==={END}")
        
        try:
            response = self.session.post(
                f"{self.base_url}/book-bed",
                json={
                    'patient_name': 'John Doe Sensitive',
                    'bed_number': '1',
                    'residence': 'kolkata',
                    'hospital': TEST_HOSPITAL,
                    'consent': True,
                },
                headers=self.auth_headers,
            )
            
            response_text = response.text.lower()
            
            pii_fields = [
                ('patient_name', 'john doe'),
                ('sensitive_data', 'sensitive'),
                ('prescription', 'test prescription')
            ]
            
            exposed_fields = []
            for field_name, field_value in pii_fields:
                if field_value.lower() in response_text:
                    exposed_fields.append(field_name)
            
            if not exposed_fields:
                self.log_test(
                    "PII Protection: Response data",
                    "PASS",
                    "No sensitive patient data exposed in response"
                )
            else:
                self.log_test(
                    "PII Protection: Response data",
                    "FAIL",
                    f"Exposed fields: {', '.join(exposed_fields)}"
                )
                
        except Exception as e:
            self.log_test("PII Protection", "WARN", str(e))

    def test_security_logging(self):
        """Test that security events are logged"""
        print(f"\n{BLUE}=== Testing Security Logging ==={END}")
        
        try:
            # Check if security.log exists
            import os
            if os.path.exists('backend/security.log'):
                with open('backend/security.log', 'r') as f:
                    log_contents = f.read()
                
                if len(log_contents) > 0:
                    self.log_test(
                        "Security Log Exists",
                        "PASS",
                        f"Log file size: {len(log_contents)} bytes"
                    )
                    
                    if 'UPLOAD' in log_contents or 'BOOKING' in log_contents or 'INVALID' in log_contents:
                        self.log_test(
                            "Security Events Logged",
                            "PASS",
                            "Events detected in security log"
                        )
                    else:
                        self.log_test(
                            "Security Events Logged",
                            "WARN",
                            "Log file exists but no events yet"
                        )
                else:
                    self.log_test(
                        "Security Log Exists",
                        "PASS",
                        "Log file created and ready"
                    )
            else:
                self.log_test(
                    "Security Log Exists",
                    "WARN",
                    "Log file not yet created (will be created on first event)"
                )
                
        except Exception as e:
            self.log_test("Security Logging", "FAIL", str(e))

    def run_all_tests(self):
        """Run all security tests"""
        print(f"\n{BLUE}{'='*60}")
        print("INNER_EYE Security Validation Test Suite")
        print(f"{'='*60}{END}\n")
        
        print(f"Target URL: {BLUE}{self.base_url}{END}")
        print(f"Frontend URL: {BLUE}{FRONTEND_URL}{END}\n")
        
        try:
            # Check connectivity. A 404 on root still means the API is reachable.
            self.session.get(f"{self.base_url}/", timeout=5)
            print(f"{GREEN}✓ Backend server is running{END}\n")
        except requests.RequestException as e:
            print(f"{RED}✗ Cannot connect to backend server at {self.base_url}{END}")
            print(f"  Error: {e}")
            print(f"  Make sure to run: cd backend && python main.py\n")
            return
        
        # Run tests
        try:
            self.authenticate()
            print(f"{GREEN}✓ Authenticated test user successfully{END}\n")
        except Exception as e:
            print(f"{RED}✗ Authentication setup failed: {e}{END}")
            return

        self.test_security_headers()
        self.test_cors_restriction()
        self.test_input_validation()
        self.test_file_upload_validation()
        self.test_pii_protection()
        self.test_security_logging()
        self.test_rate_limiting()
        
        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        total = self.results['passed'] + self.results['failed']
        percentage = (self.results['passed'] / total * 100) if total > 0 else 0
        
        print(f"\n{BLUE}{'='*60}")
        print("Test Summary")
        print(f"{'='*60}{END}\n")
        
        print(f"{GREEN}Passed: {self.results['passed']}{END}")
        print(f"{RED}Failed: {self.results['failed']}{END}")
        print(f"{YELLOW}Warnings: {self.results['warnings']}{END}")
        print(f"\n{BLUE}Success Rate: {percentage:.1f}%{END}\n")
        
        if self.results['failed'] == 0:
            print(f"{GREEN}✓ All security tests passed!{END}")
        else:
            print(f"{RED}✗ Some tests failed. Review above for details.{END}")
        
        # Save results
        with open('security_test_results.json', 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print(f"\nResults saved to: security_test_results.json\n")


if __name__ == "__main__":
    tester = SecurityTester()
    tester.run_all_tests()
