// per-file upload cap
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// per-request cap for multi-file uploads (currently single-file, kept for future use)
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES * 5;
