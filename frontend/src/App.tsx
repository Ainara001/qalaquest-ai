import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { NotFound } from "@/pages/NotFound";
import { Guide } from "@/pages/Guide";
import { Home } from "@/pages/Home";
import { Profile } from "@/pages/Profile";

// MapLibre is large; load it only when the map page is opened.
const MapPage = lazy(() => import("@/pages/MapPage").then((m) => ({ default: m.MapPage })));

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route
          path="map"
          element={
            <Suspense fallback={null}>
              <MapPage />
            </Suspense>
          }
        />
        <Route path="explore" element={<Navigate to="/map" replace />} />
        <Route path="guide" element={<Guide />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
