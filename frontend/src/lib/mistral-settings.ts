export const MISTRAL_API_KEY_STORAGE_KEY = "tppr:mistral-api-key";
export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
export const MISTRAL_CHAT_MODEL = "mistral-small-latest";

export function getStoredMistralApiKey(): string {
    return localStorage.getItem(MISTRAL_API_KEY_STORAGE_KEY)?.trim() ?? "";
}

export function setStoredMistralApiKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (trimmed) {
        localStorage.setItem(MISTRAL_API_KEY_STORAGE_KEY, trimmed);
    } else {
        localStorage.removeItem(MISTRAL_API_KEY_STORAGE_KEY);
    }
}
