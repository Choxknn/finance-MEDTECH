# QR dependencies

- qrcode-generator 1.4.4, MIT, Kazuhiko Arase. Source: https://github.com/kazuhikoarase/qrcode-generator
- jsQR 1.4.0, Apache-2.0. Source: https://github.com/cozmo/jsQR

Vendored from the versioned npm distributions, minified with Terser 5.44.0 (compress and mangle; no semantic changes). Licenses accompany these files. QR decoding happens locally in the browser; camera frames are not uploaded.

Supabase JS 2.57.4 UMD: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js
MIT license: supabase-LICENSE.txt. Used for private Realtime invalidations only; application sessions remain managed by session-history.js.
