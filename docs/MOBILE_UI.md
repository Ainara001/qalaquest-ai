# Mobile-first UI (stage 3, updated in stage 6)

> **Stage 6 changed the structure:** the map is the main screen and the navigation has **three** tabs (Map `/`, AI guide `/guide`, Profile `/profile`); Home was removed and `/walk` opens on the map. The current behaviour of the map screen, search, filters, mood and sheets is described in [MAP_FIRST_UX.md](MAP_FIRST_UX.md). The sections below are kept for the parts that did not change (viewport and keyboard handling, design system, AI guide, Profile) and for history.

## Navigation

Stage 6: three primary destinations (`frontend/src/sections.ts`): Map `/` (Карта / Карта), AI guide `/guide` (AI-гид / AI-гид), Profile `/profile` (Профиль / Профиль). The stage 3 table below is historical:

| Tab | Route | Icon | RU | KK |
|---|---|---|---|---|
| Home | `/` | Home | Главная | Басты бет |
| Map | `/map` | Map | Карта | Карта |
| AI guide | `/guide` | Sparkles | AI-гид | AI-гид |
| Profile | `/profile` | User | Профиль | Профиль |

- **Phones (< 768 px):** fixed bottom bar (icon + label, 60 px tall, active tab has a teal indicator and a heavier icon) with `padding-bottom: env(safe-area-inset-bottom)`. The header shows only the logo and the RU / ҚАЗ switch. No second navigation bar is rendered.
- **Desktop (≥ 768 px):** the same four items in the header, plus the theme toggle; the bottom bar is not rendered.
- Routing uses the existing React Router, so the Back button works; `/explore` redirects to `/map`.
- State survives tab switches because it lives in stores (`guide`, `explore`), not in page components: the chat, the AI results on the map, filters and the chosen start point stay when you move between tabs. They are in memory only and are cleared by a page reload.

## Layout and viewport

- `viewport-fit=cover` and `interactive-widget=resizes-content`; no fixed `100vh` anywhere. Full-screen pages (map, guide) use `.page-h = var(--vvh) − header − bottom bar`, where `--vvh` is the **visual viewport** height maintained by `useViewportVars`.
- While a text field is focused on a phone, or when the visual viewport shrinks by more than 150 px (iOS Safari keyboard), the `kb-open` class hides the bottom bar and the chat composer stays at the bottom of the visible area. Focus changes are debounced so a tap on "send" is not lost; the send button keeps focus in the field.
- Text inputs are 16 px (prevents iOS zoom on focus). `overscroll-contain` on the chat scroller. No horizontal page scroll (checked: `scrollWidth ≤ clientWidth` on the guide page).
- Pages that scroll (Home, Profile) get bottom padding equal to bar height + safe area, so the bar never covers content.

## Screens

- **Home:** greeting by time of day, current start point chip (device / chosen on map / named place, else "not selected"), large AI card "Открой свою Астану" with a textarea and the button "Подобрать прогулку" (sends a real request to `/api/ai/chat`), six quick scenarios that send real requests with structured parameters (nearby = asks for location first, 30 minutes, free, with a child, unusual, quiet), then compact cards of real POIs from the database (horizontal swipe on phones). Empty database → an explicit "data not loaded yet" card.
- **AI guide:** a planner, not a bubble list: user messages, then for each answer an intro, notices (assumed start point, unconfirmed "free", no results with a suggested wider radius…), recommendation cards, a follow-up question, "show all on map" and "repeat request". Cards show name, category, straight-line distance, rough travel estimate, typical visit time, hours (or "unknown"), fee status from OSM, address, the reason, an AI idea clearly labelled, source link and confidence, and an "On the map" button. No photos are shown (no licensed image source); cards are neutral text cards.
- **Map:** full-screen map; search bar and horizontally scrolling category chips float on top; floating buttons for the list, device location and clearing AI results; a bottom sheet (max 48 % height) for the selected place with a "Ask the AI guide" action (sets the place as start point of the chat); the list opens as a 72 % sheet with start-point and radius controls. AI recommendations are numbered pins above the clusters; the map keeps the place in the visible upper part above the sheet. Pinch gestures replace +/- buttons on phones. Desktop keeps the stage 2 split layout.
- **Profile (stage 4):** switch "Use my preferences", interest chips with icons, "How I like to walk" segmented controls, budget chips, accessibility switches, tri-state category chips (neutral → favourite → avoid), saved / visited / hidden place lists, privacy (opt-in device storage, clear feedback, reset, delete all with a second-tap confirmation), language, theme, AI session, geolocation explanation, about. The "save on this device?" prompt floats above the bottom bar so it never shifts the chips being tapped.
- **Personal parts elsewhere:** Home has a mood row and "places you may like" (or an optional setup card); every AI card has feedback chips (like, save, ⋯ bottom sheet with more-like-this / visited / not interesting / never) and an expandable "Why is this recommended to me?". Checked for horizontal overflow at 320 px on Home, Map, Guide, Profile.

## Design system

- **Light is the default** for new users (dark only if chosen in Profile or the header toggle; system preference is no longer used). Tokens are CSS variables in `styles/globals.css`: background `#F8FAFC`, surface `#FFFFFF`, text `#172033`, secondary text slate (`hsl(215 16% 40%)`, AA on white), border `#E2E8F0`, accent teal. The button/text accent is a darker teal (`#0F766E`-range, AA with white text); `#0D9488` is used for icons and the active indicator.
- White cards with 1 px borders, 16–24 px radii, soft shadows, 44 px minimum touch targets, Inter, no gradients except the logo, no heavy animation (only spinners and a pulse on loading skeletons).
- Components: shadcn-style `Button`, `Card`, `Badge`; app components `RecommendationCard`, `ChatMessages`, `LanguageSwitcher`, map parts.

## Localisation

All new strings exist in `ru.json` and `kk.json` (same key set, checked by script). The AI answers in the interface language unless the user asks for another one; system notices and errors are codes rendered by the frontend, so a Kazakh interface never shows Russian system text. Object names come from the database (`name_kk` / `name_ru` / original).

## Limitations

- Tested in the in-app browser with phone emulation (375 × 812) and a desktop width. **Not tested** on physical iOS / Android devices, with a real on-screen keyboard, Safari's address-bar behaviour or the iPhone home indicator; the keyboard logic (`visualViewport`, focus handling) is implemented but only verified in emulation.
- The bottom sheet on the map changes state by buttons (no drag gesture).
- Desktop "AI guide" is a single centred chat column; results open on the Map tab.
- Fonts come from Google Fonts (system fallback offline); map tiles need internet.

## Stage 5 additions

- **Walk screen `/walk`** (no fifth tab): full-screen map with the real walking line and numbered stops; a bottom sheet with three snap states (collapsed / half / full). Only the handle drags or toggles it, so map gestures and list scrolling are not hijacked. Contents: remaining time, walking time, distance; "what changed" card; stops with walking leg, estimated visit, hours and the buttons "I visited this place" / "Skip"; "Change route" (bottom sheet: time left, less walking, go indoors, interests, another place, write to AI, update location, update weather); "Finish walk"; "Why this route?"; compact weather.
- **Active-walk bar** under the header on every other page ("Walk · places: 2 · 40 min left · Open route"); full-height pages subtract its height (`--pill-h`) so nothing is covered.
- **Weather card** on Home (temperature, feels-like, wind, gusts, precipitation probability, update time, comfort advice) and in the walk sheet.
- Location is requested only on a tap; the remaining-time counter updates once a minute locally, without polling the server or the GPS.

## Stage 6 changes (summary)

- Three tabs; the bottom bar is a 3-column grid with 12 px labels. On phones the map screen has no header: the search field sits at the top with `env(safe-area-inset-top)` (`--safe-t`), and `.page-h` uses `--header-eff` (0 on the map screen on phones).
- One map sheet (`components/map/MapSheet.tsx`, collapsed / half / full, drag only on the handle) replaces the fixed-height place sheet, the list sheet and the walk sheet (`RouteSheet` was removed).
- Quick actions (Surprise me, Quest, For a group) float above the sheet on phones and sit in the side panel on desktop; map buttons (weather, recommendation layer, my location) float on the right.
- Checked for horizontal overflow at 320 / 375 / 390 / 430 px in emulation (no physical devices).
