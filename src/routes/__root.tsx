import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { getPublicRenderFlags } from "../server/server-flags";
import "../styles/app.css";
export const Route = createRootRoute({
  loader: () => getPublicRenderFlags(),
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "Toddlebook — 24-hour child care log" },
      {
        name: "description",
        content: "Create a printable 24-hour care log for parents and helpers.",
      },
    ],
  }),
});

// GTM renders on cloud `/` only (FR-03). The flag is computed server-side by
// getPublicRenderFlags; no digital/DB/auth/billing module is imported here
// and no environment value reaches the client. Transitions from `/` to any
// digital surface are full-document loads (the digital routes are non-HTML
// gate responses in this slice), so a loaded GTM container cannot persist
// into those surfaces.
function RootComponent() {
  const { gtmEnabled } = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {gtmEnabled && (
          <>
            <script
              async
              src="https://www.googletagmanager.com/gtm.js?id=GTM-NP4XPXZS"
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());`,
              }}
            />
          </>
        )}
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
