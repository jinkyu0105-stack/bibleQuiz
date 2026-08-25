import { createBrowserRouter } from "react-router-dom";

import {
  AdminPlaceholder,
  ArchivePlaceholder,
  HomePage,
  QuizPlaceholder,
  RootError,
  RootLayout,
} from "./screens";
import { getHealth } from "../lib/api-client/health";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RootError />,
    loader: getHealth,
    children: [
      { index: true, element: <HomePage /> },
      { path: "archive", element: <ArchivePlaceholder /> },
      { path: "quiz/:slug", element: <QuizPlaceholder /> },
      { path: "admin", element: <AdminPlaceholder /> },
    ],
  },
]);
