import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { ComingSoon, NotFound } from "@/pages/ComingSoon";
import { Home } from "@/pages/Home";
import { sections } from "@/sections";

// MapLibre is large; load it only when the map page is opened.
const Explore = lazy(() => import("@/pages/Explore").then((m) => ({ default: m.Explore })));

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        {sections.map((s) => (
          <Route key={s.path} path={s.path} element={s.ready ? <Suspense fallback={null}><Explore /></Suspense> : <ComingSoon />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
