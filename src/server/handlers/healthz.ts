// Liveness endpoint (FR-43): 200 without touching the database or any
// digital module. Deployment health checks point here.
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({ status: "ok" }));
