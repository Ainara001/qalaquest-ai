import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { NotFound } from "@/pages/NotFound";
import { Guide } from "@/pages/Guide";
import { Profile } from "@/pages/Profile";

// MapLibre is large; the map chunk loads separately (it is still the first screen).
const MapHome = lazy(() => import("@/pages/MapHome").then((m) => ({ default: m.MapHome })));

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route
          index
          element={
            <Suspense fallback={null}>
              <MapHome />
            </Suspense>
          }
        />
        {/* old addresses keep working: the map is now the main screen and walks open on it */}
        <Route path="map" element={<Navigate to="/" replace />} />
        <Route path="explore" element={<Navigate to="/" replace />} />
        <Route path="walk" element={<Navigate to="/?panel=walk" replace />} />
        <Route path="guide" element={<Guide />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
