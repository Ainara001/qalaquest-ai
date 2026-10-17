import { Route, Routes } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { ComingSoon, NotFound } from "@/pages/ComingSoon";
import { Home } from "@/pages/Home";
import { sections } from "@/sections";

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        {sections.map((s) => (
          <Route key={s.path} path={s.path} element={<ComingSoon />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
