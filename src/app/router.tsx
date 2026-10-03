import { createBrowserRouter } from "react-router-dom";

import {
  RootError,
  RootLayout,
} from "./screens";
import { loadPublicQuiz } from "../features/quiz/public-loader";
import { QuizLoading } from "../features/quiz/QuizLoading";

export const router = createBrowserRouter([
  { path: "/quiz/:slug/print", lazy: () => import("../features/export/print-page"), errorElement: <RootError />, hydrateFallbackElement: <main className="print-route"><p role="status">출력 파일을 준비하고 있어요.</p></main> },
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RootError />,
    hydrateFallbackElement: <div className="app-shell"><QuizLoading /></div>,
    children: [
      { index: true, loader: loadPublicQuiz, lazy: () => import("../features/quiz/public-page") },
      { path: "archive", lazy: () => import("../features/archive/page") },
      { path: "quiz/:slug/export", lazy: () => import("../features/export/blank-page") },
      { path: "quiz/:slug", loader: loadPublicQuiz, lazy: () => import("../features/quiz/public-page") },
      { path: "admin", lazy: () => import("../features/admin-weekly/Dashboard") },
      { path: "admin/operations", lazy: () => import("../features/admin-operations/page") },
      { path: "admin/manual", lazy: () => import("../features/admin-operations/Manual") },
      { path: "admin/manual/future/member-auth", lazy: () => import("../features/admin-operations/Manual") },
      { path: "admin/new", lazy: () => import("../features/admin-weekly/Workspace") },
      { path: "admin/quiz/:id", lazy: () => import("../features/admin-weekly/Workspace") },
      { path: "admin/moderation", lazy: () => import("../features/admin-weekly/Policy") },
      { path: "admin/submissions", lazy: () => import("../features/admin-weekly/Submissions") },
      { path: "admin/privacy-requests", lazy: () => import("../features/admin-weekly/PrivacyInbox") },
      { path: "admin/tools", lazy: () => import("../features/admin-bible-reference/page") },
      { path: "privacy-requests", lazy: () => import("../features/privacy/page") },
      ...(import.meta.env.DEV ? [{ path: "dev/quiz", lazy: () => import("../features/quiz/preview-page") }] : []),
    ],
  },
]);
