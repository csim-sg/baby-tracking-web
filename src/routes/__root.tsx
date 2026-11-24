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
