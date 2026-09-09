import { json, handler } from '../_lib/http.js';

// GET /api/session — wie ben ik, mag ik beheren, staat de tool achter Access?
export const onRequestGet = handler(async ({ data }) => json({ user: data.user || { email: '', admin: true, protected: false } }));
