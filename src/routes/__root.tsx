import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import "../styles/app.css";
export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
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
