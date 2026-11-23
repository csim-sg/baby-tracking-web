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
      { title: "Tiny Daybook — printable baby tracker" },
      {
        name: "description",
        content: "Create a sweet, printable baby care tracker.",
      },
    ],
  }),
});
