// Fail-closed handler for the digital surface: /app (+ subtree), auth pages,
// /api/auth/*, and POST /api/stripe/webhook (SPEC-002 route table). Serves
// the 503/404 gate response for every method so no digital path can fall
// through to the SSR catch-all (which would return the `/` document, GTM
// included, with a 200).
import { defineEventHandler, setResponseStatus } from "h3";

import { digitalGateResponse, type DigitalSurface } from "../digital-gate";

function surfaceForPath(pathname: string): DigitalSurface {
  if (pathname === "/api/stripe/webhook") {
    return "webhook";
  }
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return "app";
  }
  return "auth";
}

export default defineEventHandler(async (event) => {
  const { status, body } = await digitalGateResponse(
    surfaceForPath(event.url.pathname),
  );
  setResponseStatus(event, status);
  return body;
});
