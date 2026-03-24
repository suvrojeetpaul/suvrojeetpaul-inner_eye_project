/**
 * INNER_EYE FRONTEND SECURITY MODULE
 * Client-side security implementation
 */

class FrontendSecurity {
  /**
   * Input Validation & Sanitization
   */
  static validatePatientName(name) {
    if (!name || typeof name !== 'string') return null;
    if (name.length > 100) return null;
    // Allow alphanumeric, spaces, hyphens
    const sanitized = name.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    return sanitized.length > 0 ? sanitized : null;
  }

  static validateBedNumber(bed) {
    if (!bed || typeof bed !== 'string') return null;
    if (bed.length > 20) return null;
    const sanitized = bed.replace(/[^a-zA-Z0-9-]/g, '').trim();
    return sanitized.length > 0 ? sanitized : null;
  }

  static validateLocation(location) {
    if (!location || typeof location !== 'string') return null;
    if (location.length > 100) return null;
    // Allow alphanumeric, spaces, commas, hyphens
    const sanitized = location.replace(/[^a-zA-Z0-9\s,-]/g, '').trim();
    return sanitized.length > 0 ? sanitized : null;
  }

  static validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  static validateFile(file, maxSizeMB = 50) {
    if (!file) return { valid: false, error: 'No file selected' };
    
    // Check file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      return { valid: false, error: `File exceeds ${maxSizeMB}MB limit` };
    }

    // Check file type
    const allowedExtensions = ['.dcm', '.nii', '.nii.gz', '.jpg', '.png'];
    const fileName = file.name.toLowerCase();
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isAllowed) {
      return { valid: false, error: 'Invalid file type. Allowed: DICOM, NIfTI, JPG, PNG' };
    }

    return { valid: true };
  }

  static validatePrescriptionFile(file, maxSizeMB = 20) {
    if (!file) return { valid: false, error: 'No file selected' };

    if (file.size > maxSizeMB * 1024 * 1024) {
      return { valid: false, error: `File exceeds ${maxSizeMB}MB limit` };
    }

    const allowedExtensions = ['.img', '.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.docs'];
    const fileName = file.name.toLowerCase();
    const isAllowed = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isAllowed) {
      return { valid: false, error: 'Invalid prescription file type. Allowed: IMG, JPG, PNG, DOC, DOCX, PDF' };
    }

    return { valid: true };
  }

  /**
   * XSS Prevention - Escape HTML
   */
  static escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
  }

  /**
   * Safe Text Content Rendering
   */
  static sanitizeForDisplay(text) {
    if (!text) return '';
    return this.escapeHtml(String(text).trim());
  }

  /**
   * Rate Limiting
   */
  static createRateLimiter(maxRequests, windowMs) {
    const requests = [];
    
    return () => {
      const now = Date.now();
      // Remove old requests outside the window
      while (requests.length > 0 && requests[0] < now - windowMs) {
        requests.shift();
      }
      
      if (requests.length >= maxRequests) {
        return false; // Rate limited
      }
      
      requests.push(now);
      return true; // Allowed
    };
  }

  /**
   * Secure API Calls
   */
  static async secureApiCall(url, options = {}) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest', // CSRF protection
          ...options.headers
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error.message);
      throw error;
    }
  }

  /**
   * Secure Local Storage (avoid storing sensitive data)
   */
  static getFromLocalStorage(key) {
    try {
      const data = localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (e) {
      console.error('LocalStorage error:', e);
      return null;
    }
  }

  static setToLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('LocalStorage error:', e);
      return false;
    }
  }

  static clearLocalStorage(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error('LocalStorage error:', e);
      return false;
    }
  }

  /**
   * CSRF Token Management
   */
  static generateCsrfToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Content Security Policy Helper
   */
  static validateOrigin(url) {
    try {
      const urlObj = new URL(url);
      const currentOrigin = window.location.origin;
      return urlObj.origin === currentOrigin;
    } catch {
      return false;
    }
  }

  /**
   * Session Management
   */
  static createSessionTimeout(timeoutMs) {
    let timeoutId;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        console.warn('Session timeout');
        this.clearLocalStorage('sessionToken');
        window.location.href = '/';
      }, timeoutMs);
    };

    // Reset timeout on user activity
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, resetTimeout, true);
    });

    // Initial timeout
    resetTimeout();
  }

  /**
   * Error Handling - Don't expose sensitive info
   */
  static safeErrorMessage(error) {
    // Log full error for debugging (console only)
    console.error('[DEBUG]', error);

    // Return safe error message
    const safeMessages = {
      'Network': 'Connection error. Please check your internet.',
      'NETWORK_ERROR': 'Unable to connect to server.',
      'VALIDATION_ERROR': 'Please check your input and try again.',
      'UNAUTHORIZED': 'Session expired. Please log in again.',
      'FORBIDDEN': 'You do not have permission for this action.',
      'NOT_FOUND': 'Resource not found.',
      'RATE_LIMITED': 'Too many requests. Please try again later.',
      'SERVER_ERROR': 'Server error. Please try again later.'
    };

    return safeMessages[error.message] || 'An error occurred. Please try again.';
  }

  /**
   * Logging (without sensitive data)
   */
  static logEvent(eventType, eventData = {}) {
    const safeData = {
      timestamp: new Date().toISOString(),
      type: eventType,
      data: {
        // Only log non-sensitive fields
        action: eventData.action,
        status: eventData.status,
        // Never log:
        // - patient_name
        // - bed_number
        // - residence
        // - medical details
      }
    };

    // Send to server logging endpoint (optional)
    // if (window.logEndpoint) {
    //   fetch(window.logEndpoint, { 
    //     method: 'POST', 
    //     body: JSON.stringify(safeData) 
    //   }).catch(() => {});
    // }

    console.log('[EVENT]', safeData);
  }

  /**
   * Request Retry with Exponential Backoff
   */
  static async retryRequest(fn, maxRetries = 3, initialDelayMs = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = initialDelayMs * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
}

// Export for use in React components
export default FrontendSecurity;
